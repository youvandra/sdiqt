import { readFileSync } from "node:fs";
import { BundleManifestV1, proofRoot } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import { bundleName, flipOneByte } from "../src/lib/bundle.ts";

const DIR = new URL("../../../vectors/bundles/rdk-v328-e2e/batch-1-FACE91C06DA7/", import.meta.url);

describe("bundle helpers", () => {
  it("names a bundle by batch index and the first 12 tx hash characters", () => {
    expect(bundleName("1", "FACE91C06DA7E0D2AA")).toBe("batch-1-FACE91C06DA7");
  });

  it("flips one bit of chunk 0 and re-hashes it so only the STARK check can reject", async () => {
    const manifestJson = readFileSync(new URL("manifest.json", DIR), "utf8");
    const manifest = BundleManifestV1.parse(JSON.parse(manifestJson));
    const proofs = manifest.chunks.map((c) => new Uint8Array(readFileSync(new URL(c.file, DIR))));
    const t = await flipOneByte({ manifestJson, manifest, proofs, bytes: 0 });

    const first = proofs[0] as Uint8Array;
    const flipped = t.proofs[0] as Uint8Array;
    const changed = [...first].flatMap((b, i) => (b === flipped[i] ? [] : [i]));
    expect(changed).toEqual([t.offset]);
    expect(t.proofs[1]).toBe(proofs[1]);

    const m = BundleManifestV1.parse(JSON.parse(t.manifestJson));
    expect(m.chunks[0]?.proof_sha256).not.toBe(manifest.chunks[0]?.proof_sha256);
    expect(m.proof_root).toBe(proofRoot(m.chunks.map((c) => c.proof_sha256)));
    expect(m.state_root).toBe(manifest.state_root);
  });
});
