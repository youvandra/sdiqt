/**
 * Download a proof bundle from `/bundles/<name>/` (nginx on the host, the dev
 * fixture locally), reporting bytes as they arrive.
 */
import { BundleManifestV1, proofRoot, toHex } from "@sdiqt/protocol";

const BUNDLE_BASE: string = import.meta.env.VITE_BUNDLE_BASE ?? "/bundles";

/** Bundle directory name for a batch, as the operator uploads it. */
export const bundleName = (batchIndex: string, submitTx: string) =>
  `batch-${batchIndex}-${submitTx.slice(0, 12)}`;

export interface Bundle {
  manifestJson: string;
  manifest: BundleManifestV1;
  proofs: Uint8Array[];
  bytes: number;
}

async function bytes(url: string, onBytes: (n: number) => void, signal: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.ok)
    throw new Error(
      res.status === 404 ? "The bundle is missing on the server" : `HTTP ${res.status}`,
    );
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const parts: Uint8Array[] = [];
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    onBytes(value.length);
  }
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function fetchBundle(
  name: string,
  onProgress: (loaded: number, total: number | undefined) => void,
  signal: AbortSignal,
): Promise<Bundle> {
  let loaded = 0;
  const bump = (n: number) => {
    loaded += n;
    onProgress(loaded, undefined);
  };
  const raw = await bytes(`${BUNDLE_BASE}/${name}/manifest.json`, bump, signal);
  const manifestJson = new TextDecoder().decode(raw);
  const manifest = BundleManifestV1.parse(JSON.parse(manifestJson));
  const proofs: Uint8Array[] = [];
  for (const c of manifest.chunks) {
    proofs.push(await bytes(`${BUNDLE_BASE}/${name}/${c.file}`, bump, signal));
  }
  return { manifestJson, manifest, proofs, bytes: loaded };
}

export interface Tampered {
  manifestJson: string;
  proofs: Uint8Array[];
  offset: number;
}

/**
 * A copy of the bundle with one bit flipped in the middle of chunk 0. The
 * chunk hash and the proof root in the manifest are recomputed to match, so
 * the file-hash checks pass and only the STARK verification can reject it.
 */
export async function flipOneByte(bundle: Bundle): Promise<Tampered> {
  const first = bundle.proofs[0];
  if (!first) throw new Error("bundle has no chunks");
  const copy = first.slice();
  const offset = Math.floor(copy.length / 2);
  copy[offset] = (copy[offset] ?? 0) ^ 0x01;
  const digest = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", copy)));
  const chunks = bundle.manifest.chunks.map((c, i) =>
    i === 0 ? { ...c, proof_sha256: digest } : c,
  );
  const manifest = {
    ...bundle.manifest,
    chunks,
    proof_root: proofRoot(chunks.map((c) => c.proof_sha256)),
  };
  return {
    manifestJson: JSON.stringify(manifest),
    proofs: [copy, ...bundle.proofs.slice(1)],
    offset,
  };
}
