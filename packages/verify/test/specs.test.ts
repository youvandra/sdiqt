/**
 * Spec vectors that the TypeScript side checks: the bundle manifest schema,
 * the manifest against the chain's batch, and a QSTR against the bundle it
 * names. The proof checks of the same vectors run in Rust
 * (`crates/sdiqt-verify/tests/spec_vectors.rs`).
 */
import { readFileSync } from "node:fs";
import { BundleManifestV1, type QstrV1 } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import { type ChainBatch, manifestVsBatch, qstrVsManifest } from "../src/index.ts";

const root = new URL("../../../", import.meta.url);
const load = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));

interface Case {
  name: string;
  rule: string;
  check: string;
  manifest: string;
  chain_batch?: ChainBatch;
  differs?: string[];
}

describe("bundle vectors", () => {
  const cases = load("vectors/bundles/cases.json");
  const valid = cases.valid[0];
  const golden = BundleManifestV1.parse(JSON.parse(valid.manifest));

  it("the valid manifest parses and matches its chain batch", () => {
    expect(manifestVsBatch(golden, valid.chain_batch)).toEqual([]);
  });

  const invalid = cases.invalid as Case[];
  it.each(invalid.filter((c) => c.check === "schema"))("schema refuses $name ($rule)", (c) => {
    expect(BundleManifestV1.safeParse(JSON.parse(c.manifest)).success).toBe(false);
  });
  it.each(invalid.filter((c) => c.check === "chain"))("chain match refuses $name ($rule)", (c) => {
    const m = BundleManifestV1.parse(JSON.parse(c.manifest));
    expect(manifestVsBatch(m, c.chain_batch as ChainBatch)).toEqual(c.differs);
  });
});

describe("QSTR vectors against the bundle", () => {
  const cases = load("vectors/qstr/cases.json");
  const manifest = BundleManifestV1.parse(load(`${cases.manifest}/manifest.json`));

  it("the golden QSTR matches its bundle", () => {
    expect(qstrVsManifest(cases.valid[0].qstr, manifest)).toEqual([]);
  });
  it.each(
    cases.match_invalid as Array<{ name: string; rule: string; qstr: QstrV1; differs: string[] }>,
  )("refuses $name ($rule)", (c) => {
    expect(qstrVsManifest(c.qstr, manifest)).toEqual(c.differs);
  });
});
