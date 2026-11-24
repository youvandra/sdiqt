/**
 * Read a proof bundle from where the operator uploaded it: an https base URL
 * (`https://sdiqt.xyz/bundles`) or a local directory.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { BundleManifestV1 } from "@sdiqt/protocol";

export interface LoadedBundle {
  manifestJson: string;
  manifest: BundleManifestV1;
  proofs: Uint8Array[];
}

export type BundleSource = (name: string) => Promise<LoadedBundle | undefined>;

/** Bundle directory name for a batch, as the operator writes it. */
export const bundleName = (batchIndex: string, txhash: string) =>
  `batch-${batchIndex}-${txhash.slice(0, 12)}`;

export function bundleSource(base: string, fetcher: typeof fetch = fetch): BundleSource {
  const remote = /^https?:\/\//.test(base);
  const get = async (name: string, file: string): Promise<Uint8Array | undefined> => {
    if (remote) {
      const r = await fetcher(`${base.replace(/\/$/, "")}/${name}/${file}`);
      if (r.status === 404) return undefined;
      if (!r.ok) throw new Error(`GET ${name}/${file}: HTTP ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    }
    try {
      return new Uint8Array(await readFile(join(base, name, file)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw err;
    }
  };
  return async (name) => {
    const raw = await get(name, "manifest.json");
    if (!raw) return undefined;
    const manifestJson = new TextDecoder().decode(raw);
    const manifest = BundleManifestV1.parse(JSON.parse(manifestJson));
    const proofs: Uint8Array[] = [];
    for (const c of manifest.chunks) {
      const p = await get(name, c.file);
      if (!p) throw new Error(`bundle ${name} lists ${c.file} but it is missing`);
      proofs.push(p);
    }
    return { manifestJson, manifest, proofs };
  };
}
