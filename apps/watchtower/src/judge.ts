/**
 * Re-execute a chain batch from the archive and compare its roots, the same
 * decision `checkQledgerFraud` makes on chain (audit C1: the qledger path
 * only, never the transition-root validator).
 */
import type { BatchRecord } from "@sdiqt/archiver";
import {
  type BatchPlan,
  type BatchRoots,
  type InboxReplay,
  planBatch,
  rootDiff,
} from "@sdiqt/operator";

export const chainRoots = (b: BatchRecord): BatchRoots => ({
  inboxFrom: b.inbox_start,
  inboxEnd: b.inbox_end,
  parentRoot: b.prev_state_root,
  stateRoot: b.state_root,
  withdrawalsRoot: b.withdrawals_root,
  dataHash: b.data_hash,
});

export interface Judgement {
  match: boolean;
  /** Fields where the chain's roots differ from the honest ones. */
  differs: string[];
  honest: BatchRoots;
  /** The honest plan, from which a fraud proof is built. */
  plan: BatchPlan;
}

export function judgeBatch(
  replay: InboxReplay,
  chainId: string,
  rollupId: string,
  b: BatchRecord,
): Judgement {
  const start = BigInt(b.inbox_start);
  const end = BigInt(b.inbox_end);
  const plan = planBatch({
    chainId,
    rollupId,
    batchIndex: BigInt(b.batch_index),
    point: replay.at(start),
    records: replay.records(start, end),
    entries: replay.range(start, end),
  });
  const differs = rootDiff(plan.roots, chainRoots(b));
  return { match: differs.length === 0, differs, honest: plan.roots, plan };
}
