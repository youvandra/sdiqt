import { describe, expect, it } from "vitest";
import {
  BatchInputV1,
  BundleManifestV1,
  CanonicalJsonError,
  canonicalize,
  fromHex,
  keygen,
  PROVER_CHUNK_MAX_SIGNED_ENTRIES,
  ROLLUP_ID,
  SIGNING_CONTEXTS,
  signDocument,
  toHex,
  verifyDocument,
} from "../src/index.ts";

describe("canonical JSON", () => {
  it("sorts keys at every level and drops whitespace", () => {
    expect(canonicalize({ b: "1", a: { d: [true, null], c: "x" } })).toBe(
      '{"a":{"c":"x","d":[true,null]},"b":"1"}',
    );
  });

  it("refuses numbers", () => {
    expect(() => canonicalize({ amount: 5 })).toThrow(CanonicalJsonError);
  });

  it("escapes strings like JSON.stringify", () => {
    expect(canonicalize({ s: 'a"\n' })).toBe('{"s":"a\\"\\n"}');
  });
});

describe("hex", () => {
  it("round-trips", () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    expect(toHex(bytes)).toBe("0001feff");
    expect(fromHex("0001feff")).toEqual(bytes);
  });

  it("refuses uppercase and odd length", () => {
    expect(() => fromHex("AB")).toThrow();
    expect(() => fromHex("abc")).toThrow();
  });
});

describe("schemas", () => {
  const input = {
    format: "sdiqt-batch-input",
    version: "1",
    chain_id: "qorechain-diana",
    rollup_id: ROLLUP_ID,
    batch_index: "0",
    inbox_from: "3",
    acc_from: "",
    parent_accounts: [],
    entries: [{ height: "10", poster: "qor1x", payload: "6e6f" }],
  };

  it("accepts a batch input", () => {
    expect(BatchInputV1.parse(input)).toEqual(input);
  });

  it("refuses unknown fields, unknown versions and non-canonical integers", () => {
    expect(BatchInputV1.safeParse({ ...input, extra: "x" }).success).toBe(false);
    expect(BatchInputV1.safeParse({ ...input, version: "2" }).success).toBe(false);
    expect(BatchInputV1.safeParse({ ...input, batch_index: "01" }).success).toBe(false);
  });

  it("refuses a bundle without chunks", () => {
    expect(
      BundleManifestV1.safeParse({ format: "sdiqt-proof-bundle", version: "1", chunks: [] })
        .success,
    ).toBe(false);
  });
});

describe("ML-DSA-87 context signing", () => {
  const keys = keygen(new Uint8Array(32).fill(7));
  const doc = { format: "sdiqt-receipt", version: "1", batch_index: "4" };

  it("verifies its own signature", () => {
    const sig = signDocument(doc, keys.secretKey, SIGNING_CONTEXTS.receiptV1);
    expect(verifyDocument(doc, sig, keys.publicKey, SIGNING_CONTEXTS.receiptV1)).toBe(true);
  });

  it("binds the context and the canonical bytes", () => {
    const sig = signDocument(doc, keys.secretKey, SIGNING_CONTEXTS.receiptV1);
    expect(verifyDocument(doc, sig, keys.publicKey, SIGNING_CONTEXTS.exitPacketV1)).toBe(false);
    expect(
      verifyDocument({ ...doc, batch_index: "5" }, sig, keys.publicKey, SIGNING_CONTEXTS.receiptV1),
    ).toBe(false);
    const reordered = { batch_index: "4", version: "1", format: "sdiqt-receipt" };
    expect(verifyDocument(reordered, sig, keys.publicKey, SIGNING_CONTEXTS.receiptV1)).toBe(true);
  });
});

describe("constants", () => {
  it("come from config/constants.json", () => {
    expect(PROVER_CHUNK_MAX_SIGNED_ENTRIES).toBe(4n);
  });
});
