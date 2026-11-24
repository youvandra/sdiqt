/**
 * Batch planning from the archive: the batch trigger (plan B3), the end the
 * chain will admit, and the roots the batch must publish, with the prover
 * input that lets the Rust statement compute the same roots.
 */
import {
  buildQledgerFraudProof,
  bytesToHex,
  executeQledger,
  inboxRangeHash,
  QLEDGER_MAX_BATCH_ENTRIES,
  type QledgerEntry,
  type QledgerLedger,
  qledgerAccumulate,
} from "@qorechain/rdk";
import type { InboxRecord } from "@sdiqt/archiver";
import type { BatchInputV1 } from "@sdiqt/protocol";
import type { ReplayPoint } from "./replay.ts";

/** Blocks with no new post before a partial batch is cut (plan B3). */
export const IDLE_BLOCKS = 20n;

/** The roots a batch publishes, lowercase hex (withdrawals root empty when none). */
export interface BatchRoots {
  inboxFrom: string;
  inboxEnd: string;
  parentRoot: string;
  stateRoot: string;
  withdrawalsRoot: string;
  dataHash: string;
}

export interface BatchPlan {
  batchIndex: string;
  roots: BatchRoots;
  entries: QledgerEntry[];
  parent: QledgerLedger;
  accFrom: Uint8Array;
  /** The ledger after the batch. */
  after: QledgerLedger;
  txCount: bigint;
  /** The Rust statement's input for the same batch. */
  input: BatchInputV1;
}

const QSTR_MAGIC = "51535452"; // "QSTR"

/** Whether an entry is a commitment post of the operator itself (no ledger effect). */
export function isOwnCommitment(r: InboxRecord, operator: string | undefined): boolean {
  return operator !== undefined && r.poster === operator && r.payload.startsWith(QSTR_MAGIC);
}

/**
 * Plan B3: batch when at least one pending entry is not our own commitment
 * and either 64 entries wait or no post has landed for 20 blocks.
 */
export function shouldBatch(input: {
  pending: InboxRecord[];
  tipHeight: bigint;
  operator?: string | undefined;
}): boolean {
  const { pending, tipHeight } = input;
  if (!pending.some((r) => !isOwnCommitment(r, input.operator))) return false;
  if (BigInt(pending.length) >= BigInt(QLEDGER_MAX_BATCH_ENTRIES)) return true;
  const last = pending.at(-1);
  return last !== undefined && tipHeight - BigInt(last.height) >= IDLE_BLOCKS;
}

const hex = (b: Uint8Array): string => bytesToHex(b);

/** Plan the batch consuming `from + 1 ..= to`, starting at `point` (the state at `from`). */
export function planBatch(input: {
  chainId: string;
  rollupId: string;
  batchIndex: bigint;
  point: ReplayPoint;
  records: InboxRecord[];
  entries: QledgerEntry[];
}): BatchPlan {
  const { chainId, rollupId, point, entries } = input;
  const env = { chainId, rollupId };
  const from = point.sequence;
  const to = from + BigInt(entries.length);
  if (entries.length === 0) throw new Error("a batch consumes at least one entry");
  const parent = point.ledger.clone();
  const after = point.ledger.clone();
  const result = executeQledger(env, after, entries);
  const accTo = qledgerAccumulate({ chainId, rollupId, from, accFrom: point.acc, entries });
  const dataHash = inboxRangeHash({ chainId, rollupId, from, to, accFrom: point.acc, accTo });
  return {
    batchIndex: input.batchIndex.toString(),
    roots: {
      inboxFrom: from.toString(),
      inboxEnd: to.toString(),
      parentRoot: hex(parent.root()),
      stateRoot: hex(result.stateRoot),
      withdrawalsRoot: hex(result.withdrawalsRoot),
      dataHash: hex(dataHash),
    },
    entries,
    parent,
    accFrom: point.acc,
    after,
    txCount: BigInt(entries.length),
    input: {
      format: "sdiqt-batch-input",
      version: "1",
      chain_id: chainId,
      rollup_id: rollupId,
      batch_index: input.batchIndex.toString(),
      inbox_from: from.toString(),
      acc_from: from === 0n ? "" : hex(point.acc),
      parent_accounts: parent.accounts().map((a) => ({
        id: hex(a.id),
        balance: a.balance.toString(),
        nonce: a.nonce.toString(),
      })),
      entries: input.records.map((r) => ({
        height: r.height,
        poster: r.poster,
        payload: r.payload,
      })),
    },
  };
}

/** The fraud proof a challenger would send against `plan`, for the TS self-check. */
export function fraudProofFor(chainId: string, rollupId: string, plan: BatchPlan) {
  return buildQledgerFraudProof({ chainId, rollupId }, plan.parent, plan.accFrom, plan.entries);
}
