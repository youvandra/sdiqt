/**
 * Live submission: the planned batch goes through `SafeTx` (simulate first,
 * spend cap) and is submitted anchored. An unanchored batch can never yield a
 * settlement receipt, so `anchor: "require"` refuses instead of sending one.
 */
import { type RdkTxClient, submitBatchMsg } from "@qorechain/rdk";
import type { SafeTx } from "@sdiqt/chain";
import { fromHex } from "@sdiqt/protocol";
import type { Submitter } from "./operator.ts";

export function liveSubmitter(tx: RdkTxClient, safe: SafeTx): Submitter {
  return async (plan, roots) => {
    const input = {
      rollupId: plan.input.rollup_id,
      batchIndex: BigInt(plan.batchIndex),
      prevStateRoot: fromHex(roots.parentRoot),
      stateRoot: fromHex(roots.stateRoot),
      txCount: plan.txCount,
      dataHash: fromHex(roots.dataHash),
      withdrawalsRoot: fromHex(roots.withdrawalsRoot),
      inboxEnd: BigInt(roots.inboxEnd),
    };
    const { tx: delivered } = await safe.run({
      label: `submit batch ${plan.batchIndex}`,
      messages: [submitBatchMsg({ ...input, sequencer: tx.address })],
      send: () => tx.submitBatch(input, { anchor: "require" }),
    });
    return { txhash: delivered.transactionHash };
  };
}
