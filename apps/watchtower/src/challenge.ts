/**
 * The challenge path (plan S4-01, audit C1). A batch whose re-execution
 * disagrees with the chain is challenged only after the fraud proof we would
 * send passes `checkQledgerFraud` locally, the same decision the chain makes;
 * a proof the local check calls honest, or cannot decide, is never sent.
 * Sends go through `SafeTx`: simulated first, fee and bond against the cap.
 */
import { challengeBatchMsg, checkQledgerFraud, type RdkTxClient } from "@qorechain/rdk";
import type { BatchRecord } from "@sdiqt/archiver";
import type { SafeTx } from "@sdiqt/chain";
import { type BatchPlan, fraudProofFor } from "@sdiqt/operator";

export interface ChallengeCase {
  chainId: string;
  rollupId: string;
  batch: BatchRecord;
  plan: BatchPlan;
}

/** Proof bytes plus what the local check decided; `fraud: false` means do not send. */
export interface ChallengeDecision {
  fraud: boolean;
  proof: Uint8Array;
  /** Why the proof must not be sent, when `fraud` is false. */
  reason?: string;
}

/** Build the fraud proof for a batch and decide it exactly as the chain would. */
export function decideChallenge(c: ChallengeCase): ChallengeDecision {
  const env = { chainId: c.chainId, rollupId: c.rollupId };
  const { proof } = fraudProofFor(c.chainId, c.rollupId, c.plan);
  const b = c.batch;
  try {
    const fraud = checkQledgerFraud(
      env,
      {
        inboxStart: BigInt(b.inbox_start),
        inboxEnd: BigInt(b.inbox_end),
        dataHash: b.data_hash,
        prevStateRoot: b.prev_state_root,
        stateRoot: b.state_root,
        withdrawalsRoot: b.withdrawals_root,
      },
      proof,
    );
    return fraud
      ? { fraud, proof }
      : { fraud, proof, reason: "local checkQledgerFraud says the batch is honest" };
  } catch (err) {
    return { fraud: false, proof, reason: `local check cannot decide: ${(err as Error).message}` };
  }
}

/** Sends one challenge; returns its tx hash or throws. */
export type Challenger = (batchIndex: string, proof: Uint8Array) => Promise<{ txhash: string }>;

/**
 * Live challenger: `MsgChallengeBatch` simulated and sent through `SafeTx`,
 * with the rollup's challenge bond reserved against the spend cap.
 */
export function liveChallenger(
  tx: RdkTxClient,
  safe: SafeTx,
  rollupId: string,
  bondUqor: bigint,
): Challenger {
  return async (batchIndex, proof) => {
    const input = { rollupId, batchIndex: BigInt(batchIndex), proof };
    const { tx: delivered } = await safe.run({
      label: `challenge batch ${batchIndex}`,
      messages: [challengeBatchMsg({ ...input, challenger: tx.address })],
      amountUqor: bondUqor,
      send: () => tx.challengeBatch(input),
    });
    return { txhash: delivered.transactionHash };
  };
}
