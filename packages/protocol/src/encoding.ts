import { z } from "zod";

/** A non-negative integer written as a canonical decimal string. */
export const DecimalString = z
  .string()
  .regex(/^(0|[1-9][0-9]*)$/, "expected a canonical decimal string");

/** Lowercase hex with an even number of digits. */
export const HexString = z.string().regex(/^([0-9a-f]{2})*$/, "expected lowercase hex");

/** 32 bytes as lowercase hex. */
export const Hex32 = z.string().regex(/^[0-9a-f]{64}$/, "expected 32 bytes of lowercase hex");

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function fromHex(hex: string): Uint8Array {
  HexString.parse(hex);
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(2 * i, 2 * i + 2), 16);
  return out;
}
