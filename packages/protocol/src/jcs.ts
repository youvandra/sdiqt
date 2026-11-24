/**
 * JSON Canonicalization Scheme (RFC 8785) for SDIQT documents.
 *
 * SDIQT documents carry integers as decimal strings and bytes as lowercase
 * hex, so numbers are refused outright: that keeps canonical bytes free of
 * float formatting. Object keys sort by UTF-16 code units, as RFC 8785 says.
 */

export type JsonValue = string | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export class CanonicalJsonError extends Error {
  override readonly name = "CanonicalJsonError";
}

function serialize(value: unknown, path: string): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "bigint") {
    throw new CanonicalJsonError(`${path}: numbers are not allowed, use a decimal string`);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v, i) => serialize(v, `${path}[${i}]`)).join(",")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${serialize(v, `${path}.${k}`)}`).join(",")}}`;
  }
  throw new CanonicalJsonError(`${path}: ${typeof value} is not JSON`);
}

/** Canonical JSON text of `value`. */
export function canonicalize(value: unknown): string {
  return serialize(value, "$");
}

/** Canonical JSON bytes (UTF-8) of `value`. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalize(value));
}
