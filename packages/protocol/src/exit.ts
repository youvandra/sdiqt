/**
 * Exit packet v1: a user's signed qledger withdrawal, sealed with QoreSeal
 * (ML-KEM-1024) to the watchtower's registered KEM key, with a release height.
 * The tower keeps the newest `seq` per account and, once the chain reaches
 * `release_height`, opens the packet and posts the withdrawal to the based
 * inbox, unless the user cancelled or the account's nonce moved on.
 *
 * The header travels in clear, is the AAD of the envelope, and is signed by
 * the account's own ML-DSA-44 key, so nobody else can replace or cancel a
 * packet. The withdrawal inside stays sealed until it is used.
 */
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { z } from "zod";
import { DecimalString, Hex32, HexString } from "./encoding.ts";
import { canonicalBytes } from "./jcs.ts";

export const EXIT_PACKET_PURPOSE = "sdiqt/exit-packet/v1" as const;
export const EXIT_CANCEL_CONTEXT = "sdiqt/exit-cancel/v1" as const;
/** The QoreSeal envelope text form. */
const EnvelopeText = z.string().regex(/^qoreseal:[A-Za-z0-9_-]+$/, "expected a qoreseal: envelope");

export const ExitHeaderV1 = z.strictObject({
  v: z.literal("1"),
  purpose: z.literal(EXIT_PACKET_PURPOSE),
  chain_id: z.string().min(1),
  rollup_id: z.string().min(1),
  /** qledger account id: hash of `public_key`. */
  account: Hex32,
  /** ML-DSA-44 public key of the account. */
  public_key: HexString,
  /** Newer packets carry a higher seq; the tower keeps the highest. */
  seq: DecimalString,
  /** Nonce of the sealed withdrawal; a packet is stale once the account moves past it. */
  nonce: DecimalString,
  /** First chain height at which the tower may post the withdrawal. */
  release_height: DecimalString,
  /** The tower account the packet is sealed to. */
  tower: z.string().min(1),
  /** SHA-256 of the tower's registered ML-KEM-1024 key at sealing time. */
  tower_kem_sha256: Hex32,
});
export type ExitHeaderV1 = z.infer<typeof ExitHeaderV1>;

export const ExitPacketV1 = z.strictObject({
  header: ExitHeaderV1,
  /** ML-DSA-44 signature of the header's canonical bytes, context EXIT_PACKET_PURPOSE. */
  header_sig: HexString,
  envelope: EnvelopeText,
});
export type ExitPacketV1 = z.infer<typeof ExitPacketV1>;

export const ExitCancelBodyV1 = z.strictObject({
  v: z.literal("1"),
  purpose: z.literal(EXIT_CANCEL_CONTEXT),
  chain_id: z.string().min(1),
  rollup_id: z.string().min(1),
  account: Hex32,
  public_key: HexString,
  /** Cancels every packet of the account with this seq or lower. */
  seq: DecimalString,
});
export type ExitCancelBodyV1 = z.infer<typeof ExitCancelBodyV1>;

export const ExitCancelV1 = z.strictObject({ body: ExitCancelBodyV1, sig: HexString });
export type ExitCancelV1 = z.infer<typeof ExitCancelV1>;

const encoder = new TextEncoder();

/** The AAD of the envelope: the header's canonical bytes. */
export function exitHeaderBytes(header: ExitHeaderV1): Uint8Array {
  return canonicalBytes(ExitHeaderV1.parse(header));
}

/** ML-DSA-44 signature of a header or cancel body under its own purpose as context. */
export function signExitDocument(
  doc: ExitHeaderV1 | ExitCancelBodyV1,
  secretKey: Uint8Array,
): Uint8Array {
  return ml_dsa44.sign(canonicalBytes(doc), secretKey, { context: encoder.encode(doc.purpose) });
}

export function verifyExitDocument(
  doc: ExitHeaderV1 | ExitCancelBodyV1,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ml_dsa44.verify(signature, canonicalBytes(doc), publicKey, {
      context: encoder.encode(doc.purpose),
    });
  } catch {
    return false;
  }
}
