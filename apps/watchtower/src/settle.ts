/**
 * Settlement and validity, the two axes of a receipt (plan B5).
 *
 * Settlement comes from the chain: the batch record at the batch's index, or,
 * once the chain has pruned that record (after `finalized_batch_retention_blocks`),
 * the anchor the creator signed for it plus what the tower stored while the
 * record still existed. Validity is SDIQT's own: whether a verified STARK
 * bundle, named by a QSTR, attests the roots the chain holds.
 */
import type { ReceiptBodyV1 } from "@sdiqt/protocol";

export type Settlement = ReceiptBodyV1["settlement"];
export type Validity = ReceiptBodyV1["validity"];

/** What the chain says about one archived batch submission. */
export type ChainRecord =
  | {
      kind: "found";
      status: string;
      stateRoot: string;
      withdrawalsRoot: string;
      dataHash: string;
      submittedHeight: number;
      submittedTime: number;
    }
  | { kind: "missing" };

export interface SettleInput {
  /** The archived submission's roots and height. */
  stateRoot: string;
  withdrawalsRoot: string;
  dataHash: string;
  height: bigint;
  record: ChainRecord;
  /** A later archived submission reused this index (an upheld challenge rolled this one back). */
  supersededLater: boolean;
  /** An anchor at this batch index carries this state root. */
  anchored: boolean;
  tipHeight: bigint;
  retentionBlocks: bigint;
  /** Settlement stored on an earlier tick, if any. */
  previous?: Settlement | undefined;
}

export interface SettleResult {
  settlement: Settlement | "unknown";
  /** True when the decision used the anchor because the record is pruned. */
  pruned: boolean;
}

export function settle(i: SettleInput): SettleResult {
  // The chain reuses an index only after an upheld challenge removed the batch.
  if (i.supersededLater) return { settlement: "rejected", pruned: false };
  if (i.record.kind === "found") {
    const same =
      i.record.stateRoot === i.stateRoot &&
      i.record.withdrawalsRoot === i.withdrawalsRoot &&
      i.record.dataHash === i.dataHash;
    if (!same) return { settlement: "rejected", pruned: false };
    const s = i.record.status;
    if (s === "finalized") return { settlement: "final", pruned: false };
    if (s === "rejected") return { settlement: "rejected", pruned: false };
    return { settlement: "pending", pruned: false };
  }
  // A final batch keeps its settlement after the record goes.
  if (i.previous === "final" || i.previous === "rejected")
    return { settlement: i.previous, pruned: true };
  const old = i.tipHeight - i.height > i.retentionBlocks;
  if (old && i.anchored) return { settlement: "final", pruned: true };
  return { settlement: "unknown", pruned: false };
}

export interface ValidityInput {
  /** Honest re-execution disagrees with the chain's roots. */
  mismatch: boolean;
  /** A verified bundle named by our QSTR matches the chain's roots. */
  proven: boolean;
  /** Unix seconds now and the batch's proof deadline. */
  now: number;
  deadline: number;
}

export function validity(i: ValidityInput): Validity {
  if (i.mismatch) return "mismatch";
  if (i.proven) return "proven";
  return i.now > i.deadline ? "unproven" : "proving";
}
