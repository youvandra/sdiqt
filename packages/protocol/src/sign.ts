/**
 * ML-DSA-87 (pure) signatures over canonical JSON, separated per format and
 * version by the FIPS 204 context string.
 */
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { canonicalBytes } from "./jcs.ts";

/** Context strings, one per signed format and version. */
export const SIGNING_CONTEXTS = {
  receiptV1: "sdiqt/receipt/v1",
  exitPacketV1: "sdiqt/exit-packet/v1",
} as const;
export type SigningContext = (typeof SIGNING_CONTEXTS)[keyof typeof SIGNING_CONTEXTS];

const encoder = new TextEncoder();

export interface MlDsa87Keys {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

/** Key pair from a 32-byte seed. */
export function keygen(seed: Uint8Array): MlDsa87Keys {
  if (seed.length !== 32) throw new RangeError("ML-DSA-87 seed must be 32 bytes");
  return ml_dsa87.keygen(seed);
}

/** Sign the canonical bytes of `document` under `context`. */
export function signDocument(
  document: unknown,
  secretKey: Uint8Array,
  context: SigningContext,
): Uint8Array {
  return ml_dsa87.sign(canonicalBytes(document), secretKey, { context: encoder.encode(context) });
}

/** Verify a signature made by {@link signDocument}. */
export function verifyDocument(
  document: unknown,
  signature: Uint8Array,
  publicKey: Uint8Array,
  context: SigningContext,
): boolean {
  return ml_dsa87.verify(signature, canonicalBytes(document), publicKey, {
    context: encoder.encode(context),
  });
}
