import { existsSync, readFileSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BatchRecord } from "@sdiqt/archiver";
import { BundleManifestV1 } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import {
  type LogEvent,
  manifestVsBatch,
  ProveQueue,
  type ProverRunner,
  processProver,
} from "../src/index.ts";

const GOLDEN = new URL("../../../vectors/bundles/golden-v328/", import.meta.url).pathname;
const manifest = BundleManifestV1.parse(
  JSON.parse(readFileSync(join(GOLDEN, "manifest.json"), "utf8")),
);

/** The chain batch the golden bundle proves. */
const batch = (txhash = "AA".repeat(32), over: Partial<BatchRecord> = {}): BatchRecord => ({
  v: 1,
  kind: "batch",
  batch_index: manifest.batch_index,
  height: "100",
  txhash,
  msg_index: "0",
  sequencer: "qor1seq",
  inbox_start: manifest.inbox_from,
  inbox_end: manifest.inbox_end,
  tx_count: "11",
  prev_state_root: manifest.parent_root,
  state_root: manifest.state_root,
  withdrawals_root: manifest.withdrawals_root,
  data_hash: manifest.data_hash,
  ...over,
});

interface Fake extends ProverRunner {
  calls: string[];
}

function fakeRunner(opts: { matches?: boolean; failProve?: number } = {}): Fake {
  let failures = opts.failProve ?? 0;
  let active = 0;
  const calls: string[] = [];
  return {
    calls,
    async buildInput(txhash) {
      calls.push(`build ${txhash.slice(0, 2)}`);
      return {
        input: `in-${txhash}`,
        matches: opts.matches ?? true,
        report: "  state_root differs",
      };
    },
    async prove(_input, dir) {
      active += 1;
      if (active > 1) throw new Error("two proofs at once");
      calls.push("prove");
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      if (failures > 0) {
        failures -= 1;
        throw new Error("out of memory");
      }
      await cp(GOLDEN, dir, { recursive: true });
    },
    async verify() {
      calls.push("verify");
    },
  };
}

async function setup(
  runner: ProverRunner,
  extra: Partial<ConstructorParameters<typeof ProveQueue>[0]> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), "sdiqt-queue-"));
  const events: LogEvent[] = [];
  const q = new ProveQueue({
    runner,
    stateFile: join(dir, "queue.json"),
    workDir: dir,
    log: (e) => events.push(e),
    ...extra,
  });
  return { dir, events, q };
}

describe("prove queue", () => {
  it("proves, verifies, checks the bundle against the chain and calls onProven", async () => {
    const runner = fakeRunner();
    const { q, events } = await setup(runner, {
      onProven: async () => ({ qstr: "would_post" }),
    });
    await q.enqueue(batch());
    await q.pump();
    const [job] = q.list();
    expect(job?.state).toBe("proven");
    expect(job?.late).toBe(false);
    expect(runner.calls).toEqual(["build AA", "prove", "verify"]);
    expect(events.at(-1)).toMatchObject({ event: "proven", qstr: "would_post" });
  });

  it("ignores a batch it already has", async () => {
    const { q } = await setup(fakeRunner());
    expect(await q.enqueue(batch())).toBe(true);
    expect(await q.enqueue(batch())).toBe(false);
    expect(q.list()).toHaveLength(1);
  });

  it("runs one proof at a time in enqueue order", async () => {
    const runner = fakeRunner();
    const { q } = await setup(runner);
    await q.enqueue(batch("BB".repeat(32)));
    await q.enqueue(batch("CC".repeat(32)));
    await Promise.all([q.pump(), q.pump()]);
    expect(runner.calls).toEqual(["build BB", "prove", "verify", "build CC", "prove", "verify"]);
    expect(q.list().map((j) => j.state)).toEqual(["proven", "proven"]);
  });

  it("labels a batch the honest replay disagrees with as mismatch and never proves it", async () => {
    const runner = fakeRunner({ matches: false });
    const { q, events } = await setup(runner);
    await q.enqueue(batch());
    await q.pump();
    expect(q.list()[0]?.state).toBe("mismatch");
    expect(runner.calls).toEqual(["build AA"]);
    expect(events.at(-1)).toMatchObject({ event: "prove_mismatch", alert: true });
  });

  it("refuses a bundle whose roots differ from the chain batch", async () => {
    const { q } = await setup(fakeRunner(), { maxAttempts: 1 });
    await q.enqueue(batch("DD".repeat(32), { state_root: "00".repeat(32) }));
    await q.pump();
    expect(q.list()[0]).toMatchObject({ state: "failed" });
    expect(q.list()[0]?.error).toMatch(/state_root/);
  });

  it("retries a failed proof once, then gives up with an alert", async () => {
    const { q, events } = await setup(fakeRunner({ failProve: 5 }));
    await q.enqueue(batch());
    await q.pump();
    expect(q.list()[0]).toMatchObject({ state: "failed", attempts: 2 });
    expect(events.filter((e) => e.event === "prove_error").map((e) => e.alert)).toEqual([
      false,
      true,
    ]);
  });

  it("marks a proof past the deadline late", async () => {
    let t = Date.parse("2026-11-27T00:00:00Z");
    const now = () => {
      t += 2_000_000;
      return new Date(t);
    };
    const { q } = await setup(fakeRunner(), { now });
    await q.enqueue(batch());
    await q.pump();
    expect(q.list()[0]).toMatchObject({ state: "proven", late: true });
  });

  it("restarts a job a crash left in proving", async () => {
    const runner = fakeRunner();
    const { dir, q } = await setup(runner);
    await q.enqueue(batch());
    // Simulate a crash mid-proof: state file says proving.
    const file = join(dir, "queue.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    saved.jobs[0].state = "proving";
    await import("node:fs/promises").then((fs) => fs.writeFile(file, JSON.stringify(saved)));
    const again = new ProveQueue({ runner, stateFile: file, workDir: dir, log: () => {} });
    await again.pump();
    expect(again.list()[0]?.state).toBe("proven");
  });

  it("finishes the job in progress on stop and starts no other", async () => {
    const runner = fakeRunner();
    const { q } = await setup(runner);
    await q.enqueue(batch("EE".repeat(32)));
    await q.enqueue(batch("FF".repeat(32)));
    void q.pump();
    while (q.list()[0]?.state !== "proving") await new Promise((r) => setTimeout(r, 1));
    await q.stop();
    expect(q.list().map((j) => j.state)).toEqual(["proven", "queued"]);
  });

  it("compares every root and inbox field", () => {
    expect(manifestVsBatch(manifest, batch())).toEqual([]);
    expect(manifestVsBatch(manifest, batch("AA", { inbox_end: "99", data_hash: "00" }))).toEqual([
      "data_hash",
      "inbox_end",
    ]);
  });
});

const PROVE = new URL("../../../target/release/sdiqt-prove", import.meta.url).pathname;
const ARCHIVE = new URL("../../../vectors/archive/rdk-v328-e2e-mwd5v89d", import.meta.url).pathname;

describe.skipIf(!existsSync(PROVE))("sdiqt-prove from-archive through processProver", () => {
  const prover = (logFile: string) =>
    processProver({
      prove: PROVE,
      verify: "unused",
      archiveDir: ARCHIVE,
      chainId: "qorechain-diana",
      logFile,
    });

  it("builds batch 1 and reports MATCH", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdiqt-build-"));
    const r = await prover(join(dir, "log")).buildInput(faceTx(), dir);
    expect(r.matches).toBe(true);
    expect(existsSync(r.input)).toBe(true);
  }, 120_000);

  it("reports DIFFERS for a rolled-back fraud batch", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdiqt-build-"));
    const r = await prover(join(dir, "log")).buildInput(fraudTx(), dir);
    expect(r.matches).toBe(false);
    expect(r.report).toMatch(/root/);
  }, 120_000);
});

function archiveBatches(): BatchRecord[] {
  return readFileSync(join(ARCHIVE, "batches.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
}
function faceTx(): string {
  return archiveBatches().find((b) => b.txhash.startsWith("FACE91"))?.txhash ?? "";
}
function fraudTx(): string {
  return archiveBatches().find((b) => b.txhash.startsWith("B30CD12C"))?.txhash ?? "";
}
