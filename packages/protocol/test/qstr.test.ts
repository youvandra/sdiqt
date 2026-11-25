import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BundleManifestV1,
  decodeQstrV1,
  encodeQstrV1,
  fromHex,
  manifestSha256,
  proofRoot,
  QstrError,
  qstrFromManifest,
  toHex,
} from "../src/index.ts";

const vectors = new URL("../../../vectors/", import.meta.url);
const manifest = BundleManifestV1.parse(
  JSON.parse(readFileSync(new URL("bundles/golden-v328/manifest.json", vectors), "utf8")),
);
const golden = readFileSync(new URL("qstr/golden-v328.hex", vectors), "utf8").trim();
const q = qstrFromManifest(manifest, "sdiqt-golden");

describe("QSTR v1", () => {
  it("encodes the golden bundle to the committed bytes", () => {
    expect(toHex(encodeQstrV1(q))).toBe(golden);
  });

  it("round-trips and starts with the qledger no-op byte", () => {
    const bytes = fromHex(golden);
    expect(bytes[0]).toBe(0x51);
    expect(decodeQstrV1(bytes)).toEqual(q);
  });

  it("writes an empty withdrawals root as 32 zero bytes and reads it back as empty", () => {
    const empty = { ...q, withdrawalsRoot: "" };
    const bytes = encodeQstrV1(empty);
    expect(bytes.length).toBe(fromHex(golden).length);
    expect(toHex(bytes)).toContain(q.stateRoot + "00".repeat(32) + q.dataHash);
    expect(decodeQstrV1(bytes)).toEqual(empty);
  });

  it("agrees with the Rust bundle code on proof root and manifest hash", () => {
    expect(proofRoot(manifest.chunks.map((c) => c.proof_sha256))).toBe(manifest.proof_root);
    expect(q.manifestSha256).toBe(manifestSha256(manifest));
    expect(q.chunkCount).toBe(3);
  });

  it("refuses a manifest whose proof root does not match its chunks", () => {
    const bad = { ...manifest, proof_root: "00".repeat(32) };
    expect(() => qstrFromManifest(bad, "p")).toThrow(QstrError);
  });

  it("binds the manifest: any manifest change moves manifest_sha256", () => {
    expect(manifestSha256({ ...manifest, sp1_version: "6.10.1" })).not.toBe(q.manifestSha256);
  });

  it("refuses wrong magic, other versions, bad sig mode, truncation and trailing bytes", () => {
    const bytes = fromHex(golden);
    const setByte = (i: number, v: number) => {
      const c = bytes.slice();
      c[i] = v;
      return c;
    };
    expect(() => decodeQstrV1(setByte(0, 0x52))).toThrow(/not a QSTR/);
    expect(() => decodeQstrV1(setByte(4, 2))).toThrow(/version 2/);
    const sigAt = 5 + 1 + q.chainId.length + 1 + q.rollupId.length + 24 + 128;
    expect(bytes[sigAt]).toBe(1);
    expect(() => decodeQstrV1(setByte(sigAt, 0))).toThrow(/sig_mode byte 0/);
    expect(() => decodeQstrV1(bytes.subarray(0, bytes.length - 1))).toThrow(/ends inside/);
    expect(() => decodeQstrV1(new Uint8Array([...bytes, 0]))).toThrow(/trailing/);
  });

  it("refuses out-of-range fields when encoding", () => {
    expect(() => encodeQstrV1({ ...q, batchIndex: (1n << 64n).toString() })).toThrow(/64 bits/);
    expect(() => encodeQstrV1({ ...q, proverId: "" })).toThrow(/prover_id/);
    expect(() => encodeQstrV1({ ...q, chunkCount: 0 })).toThrow(/chunk_count/);
    expect(() => encodeQstrV1({ ...q, stateRoot: "AB".repeat(32) })).toThrow(/lowercase/);
  });
});
