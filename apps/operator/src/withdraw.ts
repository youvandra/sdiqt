/**
 * Withdrawal claims of one anchored batch, rebuilt from the archive: replay
 * the inbox up to the batch's start, execute its entries, check the
 * withdrawals root against the one the chain holds, and give each withdrawal
 * the sibling path `MsgExecuteWithdrawal` takes.
 */
import { executeQledger, qledgerWithdrawalProof } from "@qorechain/rdk";
import type { BatchRecord, InboxRecord } from "@sdiqt/archiver";
import { toHex } from "@sdiqt/protocol";
import { InboxReplay } from "./replay.ts";

export interface WithdrawalClaim {
  batchIndex: string;
  /** Global withdrawal index, as the chain numbers it. */
  index: bigint;
  recipient: string;
  amount: bigint;
  proof: Uint8Array[];
}

export function withdrawalClaims(input: {
  chainId: string;
  rollupId: string;
  entries: InboxRecord[];
  batch: BatchRecord;
}): WithdrawalClaim[] {
  const { chainId, rollupId, batch } = input;
  const replay = new InboxReplay(chainId, rollupId);
  replay.setEntries(input.entries);
  const from = BigInt(batch.inbox_start);
  const to = BigInt(batch.inbox_end);
  const { ledger } = replay.at(from);
  const result = executeQledger({ chainId, rollupId }, ledger, replay.range(from, to));
  const root = toHex(result.withdrawalsRoot);
  if (root !== batch.withdrawals_root) {
    throw new Error(
      `batch ${batch.batch_index}: replayed withdrawals root ${root || "(empty)"} differs from chain ${batch.withdrawals_root || "(empty)"}`,
    );
  }
  return result.withdrawals.map((w, i) => ({
    batchIndex: batch.batch_index,
    index: w.index,
    recipient: w.recipient,
    amount: w.amount,
    proof: qledgerWithdrawalProof(chainId, rollupId, result.withdrawals, i),
  }));
}
