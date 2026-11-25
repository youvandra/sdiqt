/**
 * Cases 1 to 3: proof bundles. Every attempt goes through `verifyBundle` from
 * `@sdiqt/verify`, the wasm build of `crates/sdiqt-verify` that the watchtower
 * calls for each batch.
 */
import { canonicalize } from "@sdiqt/protocol";
import { verifyBundle } from "@sdiqt/verify";
import { ACCEPTED, type Case, flip, loadBundle, rehash } from "./common.ts";

const golden = loadBundle("vectors/bundles/golden-v328");
const rdk = loadBundle("vectors/bundles/rdk-v328-e2e/batch-1-FACE91C06DA7");
const GOLDEN_VKEY = golden.manifest.program_vkey_hash;
/** The program the live rollup `sdiqt-1` runs; the rdk vector was proven with it. */
const LIVE_VKEY = rdk.manifest.program_vkey_hash;

function verify(json: string, proofs: Uint8Array[], vkey?: string): string {
  const v = verifyBundle(json, proofs, vkey);
  return v.valid ? ACCEPTED : (v.error ?? "invalid, no reason given");
}

const control = {
  input: `${golden.dir} (3 chunks), pinned to program ${GOLDEN_VKEY.slice(0, 12)}`,
  got: verify(golden.json, golden.proofs, GOLDEN_VKEY),
};

const SWEEP = 64;

/** Flip one bit at each of SWEEP offsets across chunk 1; count refusals and group their reasons. */
function sweep(): string {
  const p = golden.proofs[1] as Uint8Array;
  const reasons = new Map<string, number>();
  const accepted: number[] = [];
  for (let k = 0; k < SWEEP; k++) {
    const at = Math.floor((k * (p.length - 1)) / (SWEEP - 1));
    const proofs = golden.proofs.map((q, i) => (i === 1 ? flip(q, at) : q));
    const got = verify(rehash(golden.manifest, proofs), proofs, GOLDEN_VKEY);
    if (got === ACCEPTED) accepted.push(at);
    // Group by the verifier's error class, without per-offset detail.
    const reason = got.replace(/^chunk 1 proof rejected: /, "").split(":")[0] ?? got;
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  if (accepted.length) return `${ACCEPTED} at offsets ${accepted.join(", ")}`;
  const summary = [...reasons].map(([r, n]) => `${n} x ${r}`).join("; ");
  return `refused ${SWEEP} of ${SWEEP}: ${summary}`;
}

export function tamperedBundle(): Case {
  const mid = (golden.proofs[1] as Uint8Array).length >> 1;
  const flipped = golden.proofs.map((p, i) => (i === 1 ? flip(p, mid) : p));
  return {
    id: "1",
    title: "Tampered bundle: one bit flipped in a proof chunk",
    code: [
      "crates/sdiqt-verify/src/lib.rs: verify_bundle",
      "packages/verify/src/node.ts: verifyBundle",
    ],
    control,
    attempts: [
      {
        attack: `flip bit 0 of byte ${mid} in chunk-1.bin, manifest unchanged`,
        expect: /^chunk 1: proof file hash does not match the manifest$/,
        got: verify(golden.json, flipped, GOLDEN_VKEY),
      },
      {
        attack: "same flip, manifest proof_sha256 and proof_root recomputed to match",
        expect: /^chunk 1 proof rejected: /,
        got: verify(rehash(golden.manifest, flipped), flipped, GOLDEN_VKEY),
      },
      {
        attack: `bit 0 flipped at ${SWEEP} evenly spaced offsets of chunk-1.bin, one at a time, each rehashed`,
        expect: new RegExp(`^refused ${SWEEP} of ${SWEEP}: `),
        got: sweep(),
      },
    ],
  };
}

export function swappedChunk(): Case {
  // Chunk 1 of another batch (rdk batch 1) in position 1 of the golden batch.
  const foreign = golden.proofs.map((p, i) => (i === 1 ? (rdk.proofs[1] as Uint8Array) : p));
  const foreignManifest = {
    ...golden.manifest,
    chunks: golden.manifest.chunks.map((c, i) =>
      i === 1 ? { ...c, public_values: rdk.manifest.chunks[1]?.public_values ?? "" } : c,
    ),
  };
  // Chunks 0 and 1 of the golden batch in each other's place, entries kept in index order.
  const order = [1, 0, 2];
  const swapped = order.map((i) => golden.proofs[i] as Uint8Array);
  const swappedManifest = {
    ...golden.manifest,
    chunks: order.map((from, at) => ({
      ...(golden.manifest.chunks[from] as (typeof golden.manifest.chunks)[number]),
      index: String(at),
      file: `chunk-${at}.bin`,
    })),
  };
  // Same in-batch swap on the live program's vector: two valid STARKs, wrong order.
  const rdkSwapped = [rdk.proofs[1], rdk.proofs[0]] as Uint8Array[];
  const rdkSwappedManifest = {
    ...rdk.manifest,
    chunks: [1, 0].map((from, at) => ({
      ...(rdk.manifest.chunks[from] as (typeof rdk.manifest.chunks)[number]),
      index: String(at),
      file: `chunk-${at}.bin`,
    })),
  };
  return {
    id: "2",
    title: "Swapped chunk: a chunk from another batch or another position",
    code: ["crates/sdiqt-verify/src/lib.rs: verify_bundle", "crates/sdiqt-statement: link_chunks"],
    control,
    attempts: [
      {
        attack:
          "chunk 1 of rdk batch 1 placed at position 1 of the golden batch, manifest unchanged",
        expect: /^chunk 1: proof file hash does not match the manifest$/,
        got: verify(golden.json, foreign, GOLDEN_VKEY),
      },
      {
        attack:
          "same chunk, its public values copied in and proof_sha256 and proof_root recomputed",
        expect: /^chunk 1 proof rejected: /,
        got: verify(rehash(foreignManifest, foreign), foreign, GOLDEN_VKEY),
      },
      {
        attack: "golden chunks 0 and 1 swapped, files and manifest entries consistent",
        expect: /^chunks do not link: /,
        got: verify(rehash(swappedManifest, swapped), swapped, GOLDEN_VKEY),
      },
      {
        attack: "rdk batch 1 chunks 0 and 1 swapped (live program), files and manifest consistent",
        expect: /^chunks do not link: /,
        got: verify(rehash(rdkSwappedManifest, rdkSwapped), rdkSwapped, LIVE_VKEY),
      },
    ],
  };
}

export function wrongVkey(): Case {
  const relabelled = canonicalize({ ...golden.manifest, program_vkey_hash: LIVE_VKEY });
  return {
    id: "3",
    title: "Wrong verifying key hash",
    code: ["crates/sdiqt-verify/src/lib.rs: verify_bundle"],
    control,
    attempts: [
      {
        attack: `golden bundle checked by a verifier pinned to the live program ${LIVE_VKEY.slice(0, 12)}`,
        expect: /^program verifying key \S+ is not the expected \S+$/,
        got: verify(golden.json, golden.proofs, LIVE_VKEY),
      },
      {
        attack: "golden manifest relabelled with the live program's key, verifier pinned to it",
        expect: /^chunk 0 proof rejected: /,
        got: verify(relabelled, golden.proofs, LIVE_VKEY),
      },
      {
        attack: "golden manifest relabelled with an all-zero key, no pin (manifest key trusted)",
        expect: /^chunk 0 proof rejected: /,
        got: verify(
          canonicalize({ ...golden.manifest, program_vkey_hash: "00".repeat(32) }),
          golden.proofs,
        ),
      },
    ],
  };
}

/** The live program's vector verifies too, so the cases above run against a working verifier. */
export const rdkControl = () => verify(rdk.json, rdk.proofs, LIVE_VKEY);
