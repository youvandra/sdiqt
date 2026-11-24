import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BundleManifestV1, qstrFromManifest } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import { type ChainBatch, manifestVsBatch, qstrVsManifest, verifyBundle } from "../src/index.ts";

const DIR = new URL("../../../vectors/bundles/golden-v328/", import.meta.url).pathname;
const json = readFileSync(join(DIR, "manifest.json"), "utf8");
const manifest = BundleManifestV1.parse(JSON.parse(json));
const proofs = manifest.chunks.map((c) => new Uint8Array(readFileSync(join(DIR, c.file))));

const batch: ChainBatch = {
  batch_index: manifest.batch_index,
  inbox_start: manifest.inbox_from,
  inbox_end: manifest.inbox_end,
  prev_state_root: manifest.parent_root,
  state_root: manifest.state_root,
  withdrawals_root: manifest.withdrawals_root,
  data_hash: manifest.data_hash,
};

describe("bundle verification (wasm in Node)", () => {
  it("accepts the golden bundle, pinned to its program", () => {
    const v = verifyBundle(json, proofs, manifest.program_vkey_hash);
    expect(v).toMatchObject({ valid: true });
  });

  it("rejects one flipped proof byte, another program and a missing chunk", () => {
    const flipped = proofs.map((p) => p.slice());
    const first = flipped[0] as Uint8Array;
    first[first.length >> 1] = (first[first.length >> 1] as number) ^ 1;
    expect(verifyBundle(json, flipped).valid).toBe(false);
    expect(verifyBundle(json, proofs, "00".repeat(32)).error).toMatch(/not the expected/);
    expect(verifyBundle(json, proofs.slice(0, 2)).valid).toBe(false);
  });

  it("rejects a manifest whose state root was edited", () => {
    const edited = json.replace(manifest.state_root, "00".repeat(32));
    expect(verifyBundle(edited, proofs).valid).toBe(false);
  });
});

describe("matching", () => {
  it("bundle against the chain batch", () => {
    expect(manifestVsBatch(manifest, batch)).toEqual([]);
    expect(manifestVsBatch(manifest, { ...batch, state_root: "00", inbox_end: "1" })).toEqual([
      "state_root",
      "inbox_end",
    ]);
  });

  it("QSTR against the bundle it names", () => {
    const q = qstrFromManifest(manifest, "p1");
    expect(qstrVsManifest(q, manifest)).toEqual([]);
    expect(
      qstrVsManifest({ ...q, manifestSha256: "00".repeat(32), chunkCount: 2 }, manifest),
    ).toEqual(["chunk_count", "manifest_sha256"]);
  });
});
