/**
 * The spec vectors in `vectors/` that the protocol package checks, against the
 * real parsers and verifiers. `scripts/vectors.ts --check` keeps the vectors
 * themselves current.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BatchInputV1,
  decodeQstrV1,
  encodeQstrV1,
  fromHex,
  type QstrV1,
  SIGNING_CONTEXTS,
  SignedReceiptV1,
  toHex,
  verifyDocument,
} from "../src/index.ts";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const load = (path: string) => JSON.parse(read(path));

interface Named {
  name: string;
}
interface Invalid extends Named {
  rule: string;
}

describe("statement vectors: prover input", () => {
  const cases = load("vectors/statement/cases.json").batch_input;
  it.each(cases.valid as Array<Named & { input: unknown }>)("accepts $name", (c) => {
    expect(BatchInputV1.parse(c.input)).toEqual(c.input);
  });
  it.each(cases.invalid as Array<Invalid & { input: unknown }>)("refuses $name ($rule)", (c) => {
    expect(BatchInputV1.safeParse(c.input).success).toBe(false);
  });
});

describe("QSTR vectors", () => {
  const cases = load("vectors/qstr/cases.json");
  it.each(
    cases.valid as Array<Named & { hex: string; qstr: QstrV1 }>,
  )("encodes and decodes $name", (c) => {
    expect(toHex(encodeQstrV1(c.qstr))).toBe(c.hex);
    expect(decodeQstrV1(fromHex(c.hex))).toEqual(c.qstr);
  });
  it.each(
    cases.decode_invalid as Array<Invalid & { hex: string; error: string }>,
  )("decoder refuses $name ($rule)", (c) => {
    expect(() => decodeQstrV1(fromHex(c.hex))).toThrow(c.error);
  });
  it.each(
    cases.encode_invalid as Array<Invalid & { qstr: QstrV1; error: string }>,
  )("encoder refuses $name ($rule)", (c) => {
    expect(() => encodeQstrV1(c.qstr)).toThrow(c.error);
  });
  it("keeps the committed golden bytes", () => {
    expect(cases.valid[0].hex).toBe(read("vectors/qstr/golden-v328.hex").trim());
  });
});

describe("receipt vectors", () => {
  const cases = load("vectors/receipt/cases.json");
  const publicKey = fromHex(cases.public_key);
  const verify = (r: unknown) => {
    const parsed = SignedReceiptV1.safeParse(r);
    if (!parsed.success) return "schema";
    const { body, signature } = parsed.data;
    return verifyDocument(body, fromHex(signature), publicKey, SIGNING_CONTEXTS.receiptV1)
      ? "valid"
      : "signature";
  };
  it.each(cases.valid as Array<Named & { receipt: unknown }>)("accepts $name", (c) => {
    expect(verify(c.receipt)).toBe("valid");
  });
  it.each(
    cases.invalid as Array<Invalid & { receipt: unknown; check: string }>,
  )("refuses $name ($rule)", (c) => {
    expect(verify(c.receipt)).toBe(c.check);
  });
});
