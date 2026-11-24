/**
 * Dual self-check (plan A2, audit2 A11): before a batch is submitted, the RDK
 * TS fraud check and the Rust `qledger-core` statement must both accept the
 * planned roots. A wrong root costs the 1,000 QOR bond to any challenger, so
 * any disagreement, error or missing answer refuses the submit.
 */
import { checkQledgerFraud } from "@qorechain/rdk";
import { type BatchPlan, type BatchRoots, fraudProofFor } from "./plan.ts";

/** What the Rust side answers for one batch input. */
export interface RustClaim {
  inbox_from: string;
  inbox_end: string;
  parent_root: string;
  state_root: string;
  withdrawals_root: string;
  data_hash: string;
}

export interface RustClaimer {
  claim(input: BatchPlan["input"]): Promise<RustClaim>;
}

export interface SelfCheck {
  ok: boolean;
  /** Each reason the submit is refused; empty when `ok`. */
  problems: string[];
}

const FIELDS: Array<[keyof BatchRoots, keyof RustClaim]> = [
  ["inboxFrom", "inbox_from"],
  ["inboxEnd", "inbox_end"],
  ["parentRoot", "parent_root"],
  ["stateRoot", "state_root"],
  ["withdrawalsRoot", "withdrawals_root"],
  ["dataHash", "data_hash"],
];

export async function dualSelfCheck(input: {
  chainId: string;
  rollupId: string;
  plan: BatchPlan;
  /** The roots about to be submitted (equal to `plan.roots` unless forced otherwise). */
  submit: BatchRoots;
  rust: RustClaimer;
}): Promise<SelfCheck> {
  const { chainId, rollupId, plan, submit } = input;
  const problems: string[] = [];

  try {
    const { proof, honest } = fraudProofFor(chainId, rollupId, plan);
    const fraud = checkQledgerFraud(
      { chainId, rollupId },
      {
        inboxStart: BigInt(submit.inboxFrom),
        inboxEnd: BigInt(submit.inboxEnd),
        dataHash: submit.dataHash,
        prevStateRoot: submit.parentRoot,
        stateRoot: submit.stateRoot,
        withdrawalsRoot: submit.withdrawalsRoot,
      },
      proof,
    );
    if (fraud) problems.push("ts: checkQledgerFraud marks the batch fraudulent");
    const honestState = Buffer.from(honest.stateRoot).toString("hex");
    if (honestState !== submit.stateRoot) problems.push(`ts: honest state_root ${honestState}`);
  } catch (err) {
    problems.push(`ts: fraud check could not decide: ${(err as Error).message}`);
  }

  try {
    const rust = await input.rust.claim(plan.input);
    for (const [ours, theirs] of FIELDS) {
      if (rust[theirs] !== submit[ours])
        problems.push(`rust: ${theirs} ${rust[theirs]}, submit ${submit[ours]}`);
    }
  } catch (err) {
    problems.push(`rust: no claim: ${(err as Error).message}`);
  }

  return { ok: problems.length === 0, problems };
}
