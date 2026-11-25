/** Shared shapes and fixture helpers for the red-team cases. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BundleManifestV1, canonicalize, proofRoot } from "@sdiqt/protocol";

/** Repository root, resolved from this file. */
export const ROOT = new URL("../../", import.meta.url).pathname;

/** One attempt: an input handed to the real code and what came back. */
export interface Attempt {
  /** What the attacker does. */
  attack: string;
  /** The refusal the code must give, as a pattern over `got`. */
  expect: RegExp;
  /** The code's answer, or `ACCEPTED` when it took the input. */
  got: string;
}

/** One attack class: the honest input it starts from and the attempts on it. */
export interface Case {
  id: string;
  title: string;
  /** The code under test, as `path: function`. */
  code: string[];
  /** The untampered input: the same code must accept it. */
  control: { input: string; got: string };
  attempts: Attempt[];
}

export const ACCEPTED = "ACCEPTED";

/** Run `fn` and return its error message, or ACCEPTED. */
export async function outcome(fn: () => unknown): Promise<string> {
  try {
    await fn();
    return ACCEPTED;
  } catch (err) {
    return (err as Error).message;
  }
}

export const sha256Hex = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

export interface Bundle {
  dir: string;
  json: string;
  manifest: BundleManifestV1;
  proofs: Uint8Array[];
}

/** A committed bundle under `vectors/bundles`. */
export function loadBundle(rel: string): Bundle {
  const dir = join(ROOT, rel);
  const json = readFileSync(join(dir, "manifest.json"), "utf8");
  const manifest = BundleManifestV1.parse(JSON.parse(json));
  const proofs = manifest.chunks.map((c) => new Uint8Array(readFileSync(join(dir, c.file))));
  return { dir: rel, json, manifest, proofs };
}

/**
 * A manifest made consistent with `proofs`: every `proof_sha256` and the
 * `proof_root` recomputed, written canonically. This is what an attacker who
 * controls the bundle host can publish, so the only checks left are the STARK
 * and the chunk links.
 */
export function rehash(m: BundleManifestV1, proofs: Uint8Array[]): string {
  const chunks = m.chunks.map((c, i) => ({
    ...c,
    proof_sha256: sha256Hex(proofs[i] as Uint8Array),
  }));
  return canonicalize({ ...m, chunks, proof_root: proofRoot(chunks.map((c) => c.proof_sha256)) });
}

/** A copy of `p` with one bit flipped at byte `at`. */
export function flip(p: Uint8Array, at: number): Uint8Array {
  const out = p.slice();
  out[at] = (out[at] as number) ^ 0x01;
  return out;
}
