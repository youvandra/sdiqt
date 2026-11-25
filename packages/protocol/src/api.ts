/**
 * Response schemas of the watchtower's read-only JSON API, shared with the
 * explorer so both sides parse the same shapes. Integers are decimal strings
 * and bytes are lowercase hex, as in every other SDIQT format.
 */
import { z } from "zod";
import { DecimalString, Hex32, HexString } from "./encoding.ts";
import { Settlement, SignedReceiptV1, Validity } from "./schemas.ts";

/** The tower calls itself stale once its last poll is older than this. */
export const API_MAX_POLL_LAG_S = 300n;

/** Uppercase hex chain transaction hash, as QoreChain prints it. */
const TxHash = z.string().regex(/^[0-9A-F]{64}$/, "expected an uppercase tx hash");

/** `GET /api/health`: 200 when the last poll is fresh, 503 when stale or missing. */
export const ApiHealthV1 = z.strictObject({
  status: z.enum(["ok", "stale"]),
  rollup_id: z.string().min(1),
  last_poll_at: z.iso.datetime().nullable(),
  last_poll_height: DecimalString.nullable(),
  lag_s: DecimalString.nullable(),
  max_lag_s: DecimalString,
  /** The rollup's challenge window as of the last poll; null before the first poll. */
  challenge_window_s: DecimalString.nullable(),
  batches: DecimalString,
  last_receipt: z
    .strictObject({
      batch_index: DecimalString,
      submit_tx: TxHash,
      settlement: Settlement,
      validity: Validity,
      issued_at: z.iso.datetime(),
    })
    .nullable(),
});
export type ApiHealthV1 = z.infer<typeof ApiHealthV1>;

/** How the tower judged a submission by re-executing it from the archive. */
export const Judged = z.enum(["match", "mismatch"]);

/** Roots a submission put on chain. Null for rows stored before the API existed. */
export const ApiChainRoots = z.strictObject({
  prev_state_root: Hex32,
  state_root: Hex32,
  withdrawals_root: HexString,
  data_hash: Hex32,
});

/** What the proof bundle named by our QSTR claims, and whether it verified. */
export const ApiProofClaim = z.strictObject({
  parent_root: Hex32,
  state_root: Hex32,
  withdrawals_root: HexString,
  data_hash: Hex32,
  sig_mode: z.enum(["full", "v0"]),
  program_vkey_hash: HexString,
  proof_root: Hex32,
  verified: z.boolean(),
  verify_ms: DecimalString,
  chunks: z.array(z.strictObject({ index: DecimalString, proof_sha256: Hex32 })).min(1),
});
export type ApiProofClaim = z.infer<typeof ApiProofClaim>;

/** One row of `GET /api/batches`: the latest submission at each batch index. */
export const ApiBatchSummaryV1 = z.strictObject({
  batch_index: DecimalString,
  submit_tx: TxHash,
  submit_height: DecimalString,
  inbox_from: DecimalString,
  inbox_end: DecimalString,
  judged: Judged,
  settlement: Settlement.or(z.literal("unknown")),
  validity: Validity,
  proven: z.boolean(),
  submissions: DecimalString,
  /** Block time of the current submission, when the tower has seen it. */
  submitted_time: z.iso.datetime().nullable(),
});

export const ApiBatchListV1 = z.strictObject({
  rollup_id: z.string().min(1),
  batches: z.array(ApiBatchSummaryV1),
});
export type ApiBatchListV1 = z.infer<typeof ApiBatchListV1>;

/** One submission at a batch index; a rolled-back index has several. */
export const ApiSubmissionV1 = z.strictObject({
  submit_tx: TxHash,
  msg_index: DecimalString,
  submit_height: DecimalString,
  submitter: z.string().min(1),
  inbox_from: DecimalString,
  inbox_end: DecimalString,
  submitted_time: z.iso.datetime().nullable(),
  chain: ApiChainRoots.nullable(),
  judged: Judged,
  differs: z.array(z.string()),
  settlement: Settlement.or(z.literal("unknown")),
  validity: Validity,
  pruned: z.boolean(),
  qstr_tx: TxHash.nullable(),
  claim: ApiProofClaim.nullable(),
  note: z.string().nullable(),
  /** What the tower did about this submission when re-execution disagreed. */
  challenge: z
    .strictObject({
      status: z.enum(["watch", "refused", "failed", "sent", "upheld", "dismissed"]),
      reason: z.string().nullable(),
      challenge_tx: TxHash.nullable(),
      honest_state_root: Hex32,
      at: z.iso.datetime(),
      resolved_at: z.iso.datetime().nullable(),
      resubmitted_tx: TxHash.nullable(),
    })
    .nullable(),
  timeline: z.array(
    z.strictObject({ settlement: Settlement, validity: Validity, issued_at: z.iso.datetime() }),
  ),
});

/** `GET /api/batches/:i`: every submission at that index, oldest first; the last is current. */
export const ApiBatchDetailV1 = z.strictObject({
  rollup_id: z.string().min(1),
  batch_index: DecimalString,
  submissions: z.array(ApiSubmissionV1).min(1),
});
export type ApiBatchDetailV1 = z.infer<typeof ApiBatchDetailV1>;

/** `GET /api/receipts/:i`: the current submission's latest signed receipt, as JCS. */
export const ApiReceiptV1 = SignedReceiptV1;
export type ApiReceiptV1 = SignedReceiptV1;

/** Body of every non-2xx answer except a stale health check. */
export const ApiErrorV1 = z.strictObject({ error: z.string().min(1) });
