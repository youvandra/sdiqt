/**
 * The wasm verifier in the browser (wasm-bindgen `--target web` build in
 * `wasm/web`). Same Rust code as the CLI `sdiqt-verify` and the Node build.
 * The module (about 1.1 MB) loads on the first call.
 */
import init, { verifyBundle as wasmVerifyBundle } from "../wasm/web/sdiqt_verify.js";

let ready: Promise<unknown> | undefined;

/** Fetch and compile the verifier once. */
export function loadVerifier(): Promise<unknown> {
  ready ??= init({ module_or_path: new URL("../wasm/web/sdiqt_verify_bg.wasm", import.meta.url) });
  return ready;
}

export interface WebVerdict {
  valid: boolean;
  /** Time spent inside the verifier, without the download. */
  ms: number;
  /** The verifier's reason when `valid` is false. */
  error?: string;
}

/**
 * Verify a bundle: every chunk STARK, the proof file hashes, the proof root,
 * the chunk links and the linked claim against the manifest. `vkeyHash` pins
 * the program; without it the manifest's key is used.
 */
export async function verifyBundleInBrowser(
  manifestJson: string,
  proofs: Uint8Array[],
  vkeyHash?: string,
): Promise<WebVerdict> {
  await loadVerifier();
  const joined = new Uint8Array(proofs.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of proofs) {
    joined.set(p, at);
    at += p.length;
  }
  const started = performance.now();
  try {
    wasmVerifyBundle(
      manifestJson,
      joined,
      Uint32Array.from(proofs, (p) => p.length),
      vkeyHash ?? null,
    );
    return { valid: true, ms: performance.now() - started };
  } catch (err) {
    return {
      valid: false,
      ms: performance.now() - started,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
export * from "./match.ts";
