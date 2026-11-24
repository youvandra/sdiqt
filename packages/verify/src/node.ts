/**
 * The wasm verifier in Node (wasm-bindgen `--target nodejs` build in
 * `wasm/node`). The same Rust code is the CLI `sdiqt-verify` and the browser
 * build in `wasm/web`.
 */
import { createRequire } from "node:module";
import { BundleManifestV1 } from "@sdiqt/protocol";

interface WasmVerifier {
  verifyBundle(
    manifestJson: string,
    proofs: Uint8Array,
    lengths: Uint32Array,
    vkey?: string | null,
  ): void;
}

let wasm: WasmVerifier | undefined;
function load(): WasmVerifier {
  wasm ??= createRequire(import.meta.url)("../wasm/node/sdiqt_verify.js") as WasmVerifier;
  return wasm;
}

export interface BundleVerdict {
  valid: boolean;
  ms: number;
  /** The verifier's reason when `valid` is false. */
  error?: string;
}

/**
 * Verify a bundle: every chunk STARK, the proof file hashes, the proof root,
 * the chunk links and the linked claim against the manifest. `vkeyHash` pins
 * the program; without it the manifest's key is used.
 */
export function verifyBundle(
  manifestJson: string,
  proofs: Uint8Array[],
  vkeyHash?: string,
): BundleVerdict {
  const started = performance.now();
  try {
    BundleManifestV1.parse(JSON.parse(manifestJson));
    const joined = new Uint8Array(proofs.reduce((n, p) => n + p.length, 0));
    let at = 0;
    for (const p of proofs) {
      joined.set(p, at);
      at += p.length;
    }
    load().verifyBundle(
      manifestJson,
      joined,
      Uint32Array.from(proofs, (p) => p.length),
      vkeyHash ?? null,
    );
    return { valid: true, ms: performance.now() - started };
  } catch (err) {
    return { valid: false, ms: performance.now() - started, error: (err as Error).message };
  }
}
