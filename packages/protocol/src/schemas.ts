/**
 * Schemas of the SDIQT JSON formats. Every schema is strict: unknown fields
 * and unknown versions are refused.
 */
import { z } from "zod";
import { DecimalString, Hex32, HexString } from "./encoding.ts";

export const BatchInputV1 = z.strictObject({
  format: z.literal("sdiqt-batch-input"),
  version: z.literal("1"),
  chain_id: z.string().min(1),
  rollup_id: z.string().min(1),
  batch_index: DecimalString,
  inbox_from: DecimalString,
  acc_from: HexString,
  parent_accounts: z.array(
    z.strictObject({ id: Hex32, balance: DecimalString, nonce: DecimalString }),
  ),
  entries: z.array(
    z.strictObject({ height: DecimalString, poster: z.string().min(1), payload: HexString }),
  ),
});
export type BatchInputV1 = z.infer<typeof BatchInputV1>;

export const BundleManifestV1 = z.strictObject({
  format: z.literal("sdiqt-proof-bundle"),
  version: z.literal("1"),
  chain_id: z.string().min(1),
  rollup_id: z.string().min(1),
  batch_index: DecimalString,
  inbox_from: DecimalString,
  inbox_end: DecimalString,
  parent_root: Hex32,
  state_root: Hex32,
  withdrawals_root: HexString,
  data_hash: Hex32,
  sig_mode: z.enum(["full", "v0"]),
  sp1_version: z.string().min(1),
  program_vkey_hash: HexString,
  proof_root: Hex32,
  chunks: z
    .array(
      z.strictObject({
        index: DecimalString,
        file: z.string().regex(/^chunk-[0-9]+\.bin$/),
        proof_sha256: Hex32,
        public_values: HexString,
      }),
    )
    .min(1),
});
export type BundleManifestV1 = z.infer<typeof BundleManifestV1>;

/** Settlement state read from QoreChain. */
export const Settlement = z.enum(["pending", "final", "rejected"]);
/** Validity state of SDIQT's proof for the batch. */
export const Validity = z.enum(["proving", "proven", "mismatch", "unproven"]);

/** Unsigned body of receipt v1; the signature covers its canonical bytes. */
export const ReceiptBodyV1 = z.strictObject({
  format: z.literal("sdiqt-receipt"),
  version: z.literal("1"),
  chain_id: z.string().min(1),
  rollup_id: z.string().min(1),
  batch_index: DecimalString,
  prev_state_root: Hex32,
  state_root: Hex32,
  withdrawals_root: HexString,
  data_hash: Hex32,
  inbox_from: DecimalString,
  inbox_end: DecimalString,
  submit_tx: HexString,
  submit_height: DecimalString,
  submitted_time: z.iso.datetime(),
  challenge_deadline: z.iso.datetime(),
  settlement: Settlement,
  validity: Validity,
  anchor: z.strictObject({ layer_id: z.string(), layer_height: DecimalString }),
  proof: z
    .strictObject({
      statement: z.literal("sdiqt-stmt-v1"),
      sig_mode: z.enum(["full", "v0"]),
      program_vkey_hash: HexString,
      prover_id: z.string().min(1),
      chunk_count: DecimalString,
      proof_root: Hex32,
      qstr_sequence: DecimalString,
      qstr_tx: HexString,
    })
    .nullable(),
  soundness_note: z.string(),
  issued_height: DecimalString,
  issuer: z.string().min(1),
});
export type ReceiptBodyV1 = z.infer<typeof ReceiptBodyV1>;

export const SignedReceiptV1 = z.strictObject({
  body: ReceiptBodyV1,
  signature: HexString,
});
export type SignedReceiptV1 = z.infer<typeof SignedReceiptV1>;

/** `docs/counts.json`: the numbers `scripts/proof.mjs` recomputes from chain at one height. */
const LatencyS = z.number().int().nonnegative().nullable();
export const CountsV1 = z.strictObject({
  version: z.literal(1),
  chain_id: z.string().min(1),
  rollup_id: z.string().min(1),
  snapshot_height: DecimalString,
  snapshot_time: z.iso.datetime(),
  challenge_window_s: z.number().int().positive(),
  batches: z.number().int().nonnegative(),
  batches_live: z.number().int().nonnegative(),
  batches_proven: z.number().int().nonnegative(),
  batches_final: z.number().int().nonnegative(),
  batches_pending: z.number().int().nonnegative(),
  batches_rejected: z.number().int().nonnegative(),
  batches_unproven: z.number().int().nonnegative(),
  batches_mismatch: z.number().int().nonnegative(),
  qstr_posts: z.number().int().nonnegative(),
  user_entries: z.number().int().nonnegative(),
  deposits: z.number().int().nonnegative(),
  transfers: z.number().int().nonnegative(),
  withdrawals: z.number().int().nonnegative(),
  proof_latency_s: z.strictObject({
    median: LatencyS,
    max: LatencyS,
    max_small_batches: LatencyS,
  }),
  latest_batch: z
    .strictObject({
      index: DecimalString,
      settlement: Settlement,
      validity: Validity,
    })
    .nullable(),
  claims_checked: z.number().int().nonnegative(),
  claims_ok: z.number().int().nonnegative(),
});
export type CountsV1 = z.infer<typeof CountsV1>;
