/**
 * The prove queue: every chain batch the operator decides to prove becomes a
 * job, and jobs run one at a time (the Mac proves one chunk with ~10 GB of
 * RAM, so a second prover would swap). A job builds the batch input from the
 * archive, checks the host claim against the chain's roots, proves, verifies
 * the bundle with the independent verifier and hands the manifest to
 * `onProven` (QSTR post, upload).
 *
 * A batch whose chain roots differ from the honest re-execution is labelled
 * `mismatch` and never proven: the proof would attest the honest roots, which
 * is the watchtower's evidence, and the challenge path handles the batch.
 *
 * State lives in one JSON file written atomically, so a restart picks up
 * where it stopped; a job caught mid-proof is retried from the start.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { BatchRecord } from "@sdiqt/archiver";
import { BundleManifestV1, manifestSha256, PROVER_PROOF_DEADLINE_S } from "@sdiqt/protocol";
import { manifestVsBatch } from "@sdiqt/verify";
import type { LogEvent } from "./operator.ts";

export type JobState = "queued" | "proving" | "proven" | "mismatch" | "failed";

export interface ProveJob {
  key: string;
  batch_index: string;
  txhash: string;
  height: string;
  submitter: string;
  inbox: string;
  state: JobState;
  attempts: number;
  enqueued_at: string;
  started_at?: string;
  finished_at?: string;
  /** Seconds from enqueue to verified bundle. */
  latency_s?: number;
  /** True when the bundle verified after enqueue + PROVER_PROOF_DEADLINE_S. */
  late?: boolean;
  bundle_dir?: string;
  manifest_sha256?: string;
  error?: string;
}

/** The prover binaries, behind an interface so tests need no 10 GB proof. */
export interface ProverRunner {
  /** Write the batch input for the batch in `txhash`; returns its path and whether the host claim matches the chain. */
  buildInput(
    txhash: string,
    outDir: string,
  ): Promise<{ input: string; matches: boolean; report: string }>;
  prove(input: string, bundleDir: string): Promise<void>;
  /** Resolves when `sdiqt-verify bundle` prints VALID; rejects otherwise. */
  verify(bundleDir: string): Promise<void>;
}

export interface ProveQueueOptions {
  runner: ProverRunner;
  /** JSON state file, for example data/operator/<rollup>-prove-queue.json. */
  stateFile: string;
  /** Where inputs and bundles go: <workDir>/inputs, <workDir>/bundles. */
  workDir: string;
  maxAttempts?: number;
  log: (e: LogEvent) => void;
  /** Called once per verified bundle, before the job is marked proven. */
  onProven?: (
    job: ProveJob,
    manifest: BundleManifestV1,
  ) => Promise<Record<string, unknown> | undefined>;
  now?: () => Date;
}

export const jobKey = (b: Pick<BatchRecord, "txhash" | "msg_index">) =>
  `${b.txhash}:${b.msg_index}`;

/** Fields where a bundle manifest disagrees with the chain's batch (one home: @sdiqt/verify). */
export { manifestVsBatch };

export class ProveQueue {
  private readonly o: ProveQueueOptions;
  private jobs: ProveJob[] = [];
  private batches = new Map<string, BatchRecord>();
  private running: Promise<void> | undefined;
  private loaded = false;
  private stopping = false;

  constructor(options: ProveQueueOptions) {
    this.o = options;
  }

  private now(): Date {
    return this.o.now ? this.o.now() : new Date();
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const saved = JSON.parse(await readFile(this.o.stateFile, "utf8")) as {
        jobs: ProveJob[];
        batches: BatchRecord[];
      };
      this.jobs = saved.jobs;
      this.batches = new Map(saved.batches.map((b) => [jobKey(b), b]));
      // A proof cut off by a restart starts again.
      for (const j of this.jobs) if (j.state === "proving") j.state = "queued";
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    this.loaded = true;
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.o.stateFile), { recursive: true });
    const tmp = `${this.o.stateFile}.tmp`;
    const text = JSON.stringify({ jobs: this.jobs, batches: [...this.batches.values()] }, null, 2);
    await writeFile(tmp, `${text}\n`);
    await rename(tmp, this.o.stateFile);
  }

  list(): readonly ProveJob[] {
    return this.jobs;
  }

  pending(): number {
    return this.jobs.filter((j) => j.state === "queued" || j.state === "proving").length;
  }

  /** Whether any job waits, reading the saved queue first (so a restart resumes). */
  async hasWork(): Promise<boolean> {
    await this.load();
    return this.pending() > 0;
  }

  /** Add a chain batch; a batch already queued or done is ignored. */
  async enqueue(b: BatchRecord): Promise<boolean> {
    await this.load();
    const key = jobKey(b);
    if (this.batches.has(key)) return false;
    this.batches.set(key, b);
    const job: ProveJob = {
      key,
      batch_index: b.batch_index,
      txhash: b.txhash,
      height: b.height,
      submitter: b.sequencer,
      inbox: `${b.inbox_start}..${b.inbox_end}`,
      state: "queued",
      attempts: 0,
      enqueued_at: this.now().toISOString(),
    };
    this.jobs.push(job);
    await this.save();
    this.o.log({
      event: "prove_queued",
      batch_index: job.batch_index,
      txhash: job.txhash,
      queue: this.pending(),
    });
    return true;
  }

  /**
   * Start the worker if it is idle. Returns the running promise so tests and
   * `drain` can wait; the operator loop does not await it.
   */
  pump(): Promise<void> {
    if (!this.running && !this.stopping) {
      this.running = this.work().finally(() => {
        this.running = undefined;
      });
    }
    return this.running ?? Promise.resolve();
  }

  /** Let the job in progress finish, start no other, and wait for it. */
  async stop(): Promise<void> {
    this.stopping = true;
    await this.running;
  }

  private async work(): Promise<void> {
    await this.load();
    while (!this.stopping) {
      const job = this.jobs.find((j) => j.state === "queued");
      if (!job) return;
      await this.runJob(job);
    }
  }

  private async runJob(job: ProveJob): Promise<void> {
    const { runner, workDir, log } = this.o;
    const batch = this.batches.get(job.key);
    if (!batch) throw new Error(`prove queue lost batch ${job.key}`);
    job.state = "proving";
    job.attempts += 1;
    job.started_at = this.now().toISOString();
    delete job.error;
    await this.save();
    log({
      event: "prove_start",
      batch_index: job.batch_index,
      txhash: job.txhash,
      attempt: job.attempts,
    });

    try {
      const built = await runner.buildInput(job.txhash, join(workDir, "inputs"));
      if (!built.matches) {
        job.state = "mismatch";
        job.finished_at = this.now().toISOString();
        job.error = built.report;
        await this.save();
        log({
          event: "prove_mismatch",
          alert: true,
          batch_index: job.batch_index,
          txhash: job.txhash,
          report: built.report,
        });
        return;
      }
      const bundleDir = join(
        workDir,
        "bundles",
        `batch-${job.batch_index}-${job.txhash.slice(0, 12)}`,
      );
      await runner.prove(built.input, bundleDir);
      await runner.verify(bundleDir);
      const manifest = BundleManifestV1.parse(
        JSON.parse(await readFile(join(bundleDir, "manifest.json"), "utf8")),
      );
      const diff = manifestVsBatch(manifest, batch);
      if (diff.length > 0)
        throw new Error(`bundle disagrees with the chain batch on ${diff.join(", ")}`);

      job.bundle_dir = bundleDir;
      job.manifest_sha256 = manifestSha256(manifest);
      const done = this.now();
      job.latency_s = Math.round((done.getTime() - Date.parse(job.enqueued_at)) / 1000);
      job.late = BigInt(job.latency_s) > PROVER_PROOF_DEADLINE_S;
      const extra = this.o.onProven ? await this.o.onProven(job, manifest) : undefined;
      job.state = "proven";
      job.finished_at = done.toISOString();
      await this.save();
      log({
        event: "proven",
        batch_index: job.batch_index,
        txhash: job.txhash,
        latency_s: job.latency_s,
        late: job.late,
        manifest_sha256: job.manifest_sha256,
        ...(extra ?? {}),
      });
    } catch (err) {
      const max = this.o.maxAttempts ?? 2;
      job.error = String(err);
      job.state = job.attempts >= max ? "failed" : "queued";
      if (job.state === "failed") job.finished_at = this.now().toISOString();
      await this.save();
      log({
        event: "prove_error",
        alert: job.state === "failed",
        batch_index: job.batch_index,
        txhash: job.txhash,
        attempt: job.attempts,
        state: job.state,
        error: job.error,
      });
    }
  }
}
