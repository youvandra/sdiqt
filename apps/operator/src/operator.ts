/**
 * The SDIQT operator loop. Each tick it catches the archive up, checks every
 * batch the chain received since the last tick against its own replay, and,
 * when the batch trigger fires, plans the next batch and runs the dual
 * self-check. In `shadow` mode it only logs what it would submit; in `live`
 * mode a batch that passed the self-check is simulated and submitted.
 *
 * Another bonded submitter may batch a based inbox first (audit H4). The
 * operator never races it: it checks that batch like any other and leaves its
 * own plan for the next range.
 */
import { readFile } from "node:fs/promises";
import { chooseQledgerBatchEnd, type RdkClient } from "@qorechain/rdk";
import { ArchiveLagError, type BatchRecord, catchUp, readArchive } from "@sdiqt/archiver";
import { type BatchPlan, type BatchRoots, planBatch, shouldBatch } from "./plan.ts";
import type { ProveQueue } from "./prove-queue.ts";
import { InboxReplay } from "./replay.ts";
import { dualSelfCheck, type RustClaimer } from "./selfcheck.ts";

export type Mode = "shadow" | "live";
export type Control = "run" | "pause" | "drain";

export type LogEvent = Record<string, unknown> & { event: string };

/** Sends a planned batch; only called in live mode, after the self-check passed. */
export type Submitter = (plan: BatchPlan, roots: BatchRoots) => Promise<{ txhash: string }>;

export interface OperatorOptions {
  client: RdkClient;
  chainId: string;
  rollupId: string;
  archiveDir: string;
  rust: RustClaimer;
  mode: Mode;
  /** Our sequencer address (live mode; also marks our own commitment posts). */
  operator?: string;
  submit?: Submitter;
  /** A file holding `run`, `pause` or `drain`; missing means `run`. */
  controlFile?: string;
  /** When set, every chain batch that lands after start is queued for proving. */
  proveQueue?: ProveQueue;
  /** Log a `heartbeat` every this many ticks (0 = never), so idle and dead differ. */
  heartbeatTicks?: number;
  log: (e: LogEvent) => void;
}

const rootsOf = (b: BatchRecord): BatchRoots => ({
  inboxFrom: b.inbox_start,
  inboxEnd: b.inbox_end,
  parentRoot: b.prev_state_root,
  stateRoot: b.state_root,
  withdrawalsRoot: b.withdrawals_root,
  dataHash: b.data_hash,
});

/** Fields where two sets of roots differ. */
export function rootDiff(a: BatchRoots, b: BatchRoots): string[] {
  return (Object.keys(a) as Array<keyof BatchRoots>).filter((k) => a[k] !== b[k]);
}

const batchKey = (b: BatchRecord) => `${b.txhash}:${b.msg_index}`;

export class Operator {
  private readonly o: OperatorOptions;
  private readonly replay: InboxReplay;
  private seen: Set<string> | undefined;
  private ticks = 0;
  /** Shadow plans by inbox start, matched when the chain's batch for that start lands. */
  private readonly wouldSubmit = new Map<string, BatchRoots>();
  readonly stats = {
    indexLags: 0,
    chainBatches: 0,
    chainMatched: 0,
    plans: 0,
    plansMatched: 0,
    refused: 0,
    submitted: 0,
  };

  constructor(options: OperatorOptions) {
    this.o = options;
    this.replay = new InboxReplay(options.chainId, options.rollupId);
  }

  private async control(): Promise<Control> {
    if (!this.o.controlFile) return "run";
    try {
      const v = (await readFile(this.o.controlFile, "utf8")).trim();
      return v === "pause" || v === "drain" ? v : "run";
    } catch {
      return "run";
    }
  }

  /** Re-execute a batch the chain received and compare its roots. */
  checkChainBatch(b: BatchRecord): { match: boolean; diff: string[] } {
    const start = BigInt(b.inbox_start);
    const end = BigInt(b.inbox_end);
    const plan = planBatch({
      chainId: this.o.chainId,
      rollupId: this.o.rollupId,
      batchIndex: BigInt(b.batch_index),
      point: this.replay.at(start),
      records: this.replay.records(start, end),
      entries: this.replay.range(start, end),
    });
    const diff = rootDiff(plan.roots, rootsOf(b));
    return { match: diff.length === 0, diff };
  }

  /** Check every archived batch against the replay, oldest first. */
  async verifyHistory(): Promise<{ batches: number; matched: number; differing: BatchRecord[] }> {
    const { entries, batches } = await readArchive(this.o.archiveDir);
    this.replay.setEntries(entries);
    const differing: BatchRecord[] = [];
    for (const b of batches) {
      const { match, diff } = this.checkChainBatch(b);
      if (!match) {
        differing.push(b);
        this.o.log({
          event: "history_differs",
          batch_index: b.batch_index,
          txhash: b.txhash,
          differs: diff,
        });
      }
    }
    return { batches: batches.length, matched: batches.length - differing.length, differing };
  }

  async tick(): Promise<void> {
    const { client, chainId, rollupId, archiveDir, log } = this.o;
    this.ticks += 1;
    try {
      await catchUp({ client, chainId, rollupId, dir: archiveDir });
    } catch (err) {
      if (!(err instanceof ArchiveLagError)) throw err;
      // The index trails the head for a block or two; skip this tick quietly.
      this.stats.indexLags += 1;
      return log({ event: "index_lag", archived: err.archived, head: err.head });
    }
    const { entries, batches } = await readArchive(archiveDir);
    this.replay.setEntries(entries);
    const [inbox, tip] = await Promise.all([client.rest.getInbox(rollupId), client.getChainTip()]);

    if (this.seen === undefined) {
      this.seen = new Set(batches.map(batchKey));
      log({
        event: "start",
        mode: this.o.mode,
        archived_batches: batches.length,
        head: inbox.headSequence,
      });
    } else {
      for (const b of batches) {
        if (this.seen.has(batchKey(b))) continue;
        this.seen.add(batchKey(b));
        const { match, diff } = this.checkChainBatch(b);
        this.stats.chainBatches += 1;
        if (match) this.stats.chainMatched += 1;
        const planned = this.wouldSubmit.get(b.inbox_start);
        let planMatch: boolean | undefined;
        if (planned) {
          planMatch = rootDiff(planned, rootsOf(b)).length === 0;
          this.stats.plans += 1;
          if (planMatch) this.stats.plansMatched += 1;
          this.wouldSubmit.delete(b.inbox_start);
        }
        log({
          event: "chain_batch",
          batch_index: b.batch_index,
          txhash: b.txhash,
          height: b.height,
          inbox: `${b.inbox_start}..${b.inbox_end}`,
          submitter: b.sequencer,
          ours: b.sequencer === this.o.operator,
          roots_match: match,
          ...(diff.length ? { differs: diff } : {}),
          ...(planned
            ? { our_plan: `${planned.inboxFrom}..${planned.inboxEnd}`, plan_equal: planMatch }
            : {}),
        });
        // Any bonded submitter may batch our inbox (audit H4): prove whatever landed.
        if (this.o.proveQueue) await this.o.proveQueue.enqueue(b);
      }
    }

    if (this.o.proveQueue && this.o.proveQueue.pending() > 0) void this.o.proveQueue.pump();

    const every = this.o.heartbeatTicks ?? 0;
    if (every > 0 && this.ticks % every === 0) {
      log({
        event: "heartbeat",
        head: inbox.headSequence,
        consumed: inbox.consumedSequence,
        ...this.stats,
        ...(this.o.proveQueue ? { prove_pending: this.o.proveQueue.pending() } : {}),
      });
    }

    const control = await this.control();
    if (control === "pause") return log({ event: "paused" });

    const consumed = BigInt(inbox.consumedSequence);
    const head = BigInt(inbox.headSequence);
    if (head <= consumed || head > this.replay.head) return;
    const pending = this.replay.records(consumed, head);
    const trigger =
      control === "drain" ||
      shouldBatch({ pending, tipHeight: BigInt(tip.height), operator: this.o.operator });
    if (!trigger) return;

    const end = await chooseQledgerBatchEnd({
      consumed,
      head,
      retained: async (x) => (await client.rest.getInbox(rollupId, x)).rangeDataHash !== "",
    });
    if (end === undefined) return;
    const last = batches.filter((b) => b.inbox_end === consumed.toString()).at(-1);
    const batchIndex = last ? BigInt(last.batch_index) + 1n : 0n;
    const plan = planBatch({
      chainId,
      rollupId,
      batchIndex,
      point: this.replay.at(consumed),
      records: this.replay.records(consumed, end),
      entries: this.replay.range(consumed, end),
    });
    await this.submitPlan(plan, plan.roots);
  }

  /** Self-check `roots` for `plan` and, in live mode, submit them. */
  async submitPlan(plan: BatchPlan, roots: BatchRoots): Promise<boolean> {
    const { chainId, rollupId, log } = this.o;
    const check = await dualSelfCheck({
      chainId,
      rollupId,
      plan,
      submit: roots,
      rust: this.o.rust,
    });
    const base = {
      batch_index: plan.batchIndex,
      inbox: `${roots.inboxFrom}..${roots.inboxEnd}`,
      state_root: roots.stateRoot,
    };
    if (!check.ok) {
      this.stats.refused += 1;
      log({ event: "refused", alert: true, ...base, problems: check.problems });
      return false;
    }
    if (this.o.mode === "shadow") {
      const prev = this.wouldSubmit.get(roots.inboxFrom);
      this.wouldSubmit.set(roots.inboxFrom, roots);
      if (!prev || rootDiff(prev, roots).length > 0) log({ event: "would_submit", ...base });
      return true;
    }
    if (!this.o.submit) throw new Error("live mode needs a submitter");
    const { txhash } = await this.o.submit(plan, roots);
    this.stats.submitted += 1;
    log({ event: "submitted", ...base, txhash });
    return true;
  }
}
