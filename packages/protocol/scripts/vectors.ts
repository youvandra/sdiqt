/**
 * Write the test vectors and JSON Schemas that the specs in `specs/` cite.
 *
 *   node packages/protocol/scripts/vectors.ts          write every file
 *   node packages/protocol/scripts/vectors.ts --check  fail if a committed file differs
 *
 * Every output is a pure function of the committed golden bundle
 * (`vectors/bundles/golden-v328`) and fixed seeds, so a second run writes the
 * same bytes. JSON Schemas come from the zod schemas with `z.toJSONSchema`.
 * Valid and invalid cases are checked against the real parsers and verifiers
 * by `packages/protocol/test/specs.test.ts`, `packages/verify/test/specs.test.ts`
 * and `crates/sdiqt-verify/tests/spec_vectors.rs`.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "@noble/hashes/sha2.js";
import { ml_dsa87 } from "@noble/post-quantum/ml-dsa.js";
import { z } from "zod";
import {
  BatchInputV1,
  BundleManifestV1,
  canonicalBytes,
  canonicalize,
  ExitCancelV1,
  ExitPacketV1,
  encodeQstrV1,
  fromHex,
  keygen,
  manifestSha256,
  proofRoot,
  type QstrV1,
  type ReceiptBodyV1,
  SIGNING_CONTEXTS,
  SignedReceiptV1,
  toHex,
} from "../src/index.ts";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const GOLDEN = "vectors/bundles/golden-v328";
const GENERATOR = "packages/protocol/scripts/vectors.ts";

const manifestText = readFileSync(`${ROOT}${GOLDEN}/manifest.json`, "utf8");
const manifest = BundleManifestV1.parse(JSON.parse(manifestText));
const proofs = manifest.chunks.map(
  (c) => new Uint8Array(readFileSync(`${ROOT}${GOLDEN}/${c.file}`)),
);

const outputs = new Map<string, string>();
const json = (path: string, value: unknown) =>
  outputs.set(path, `${JSON.stringify(value, null, 2)}\n`);
const schema = (path: string, s: z.ZodType) => json(path, z.toJSONSchema(s));
const header = (spec: string) => ({ spec, generator: GENERATOR });

// ---------------------------------------------------------------------------
// Statement: chunk public values (bincode 1, legacy options) and chunk linking.

interface RawChunk {
  chain_id: Uint8Array;
  rollup_id: Uint8Array;
  start_root: Uint8Array;
  end_root: Uint8Array;
  inbox_from: bigint;
  inbox_to: bigint;
  acc_from: Uint8Array;
  acc_to: Uint8Array;
  withdrawals: { index: bigint; recipient: Uint8Array; amount: bigint }[];
  /** Enum variant: 0 full, 1 v0. Other values only appear in invalid vectors. */
  mode: number;
  /** Bool bytes: 0 or 1. Other values only appear in invalid vectors. */
  sig_bits: number[];
}

const utf8 = new TextEncoder();
const utf8Out = new TextDecoder();

function u64le(v: bigint): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, v, true);
  return b;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

const bytesField = (b: Uint8Array) => concat([u64le(BigInt(b.length)), b]);

function encodeChunk(c: RawChunk): Uint8Array {
  const mode = new Uint8Array(4);
  new DataView(mode.buffer).setUint32(0, c.mode, true);
  return concat([
    bytesField(c.chain_id),
    bytesField(c.rollup_id),
    c.start_root,
    c.end_root,
    u64le(c.inbox_from),
    u64le(c.inbox_to),
    c.acc_from,
    c.acc_to,
    u64le(BigInt(c.withdrawals.length)),
    ...c.withdrawals.flatMap((w) => [u64le(w.index), bytesField(w.recipient), u64le(w.amount)]),
    mode,
    u64le(BigInt(c.sig_bits.length)),
    new Uint8Array(c.sig_bits),
  ]);
}

function decodeChunk(bytes: Uint8Array): RawChunk {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 0;
  const take = (n: number) => {
    if (o + n > bytes.length) throw new Error("public values end early");
    const out = bytes.slice(o, o + n);
    o += n;
    return out;
  };
  const u64 = () => {
    take(8);
    return view.getBigUint64(o - 8, true);
  };
  const field = () => take(Number(u64()));
  const c: RawChunk = {
    chain_id: field(),
    rollup_id: field(),
    start_root: take(32),
    end_root: take(32),
    inbox_from: u64(),
    inbox_to: u64(),
    acc_from: take(32),
    acc_to: take(32),
    withdrawals: Array.from({ length: Number(u64()) }, () => ({
      index: u64(),
      recipient: field(),
      amount: u64(),
    })),
    mode: (() => {
      take(4);
      return view.getUint32(o - 4, true);
    })(),
    sig_bits: Array.from(field()),
  };
  if (o !== bytes.length) throw new Error("public values have trailing bytes");
  return c;
}

/** The JSON view of a decoded chunk output, as the Rust test prints it. */
function chunkView(c: RawChunk) {
  return {
    chain_id: utf8Out.decode(c.chain_id),
    rollup_id: utf8Out.decode(c.rollup_id),
    start_root: toHex(c.start_root),
    end_root: toHex(c.end_root),
    inbox_from: c.inbox_from.toString(),
    inbox_to: c.inbox_to.toString(),
    acc_from: toHex(c.acc_from),
    acc_to: toHex(c.acc_to),
    withdrawals: c.withdrawals.map((w) => ({
      index: w.index.toString(),
      recipient: utf8Out.decode(w.recipient),
      amount: w.amount.toString(),
    })),
    sig_mode: c.mode === 0 ? "full" : "v0",
    sig_bits: c.sig_bits.map((b) => b === 1),
  };
}

const golden = manifest.chunks.map((c) => {
  const bytes = fromHex(c.public_values);
  const raw = decodeChunk(bytes);
  if (toHex(encodeChunk(raw)) !== c.public_values)
    throw new Error("chunk codec does not round-trip");
  return raw;
});
const [c0, c1, c2] = golden as [RawChunk, RawChunk, RawChunk];
const pv = (c: RawChunk) => toHex(encodeChunk(c));
const flip = (b: Uint8Array, i = 0) => {
  const out = b.slice();
  out[i] = (out[i] as number) ^ 1;
  return out;
};

const truncated = fromHex(manifest.chunks[0]?.public_values ?? "");
const badUtf8 = truncated.slice();
badUtf8[8] = 0xff;

const batchInput = {
  format: "sdiqt-batch-input",
  version: "1",
  chain_id: "qorechain-diana",
  rollup_id: "sdiqt-1",
  batch_index: "0",
  inbox_from: "0",
  acc_from: "",
  parent_accounts: [],
  entries: [{ height: "10", poster: "qor1poster", payload: "6e6f" }],
};
json("vectors/statement/cases.json", {
  ...header("specs/statement-v1.md"),
  decode: {
    valid: golden.map((c, i) => ({
      name: `golden-v328 chunk ${i}`,
      public_values: pv(c),
      output: chunkView(c),
    })),
    invalid: [
      {
        name: "ends one byte early",
        rule: "STMT-1",
        public_values: toHex(truncated.subarray(0, truncated.length - 1)),
      },
      {
        name: "one byte after sig_bits",
        rule: "STMT-1",
        public_values: toHex(Uint8Array.from([...fromHex(pv(c0)), 0])),
      },
      { name: "chain_id is not UTF-8", rule: "STMT-2", public_values: toHex(badUtf8) },
      { name: "signature mode variant 2", rule: "STMT-3", public_values: pv({ ...c0, mode: 2 }) },
      {
        name: "signature bit byte 2",
        rule: "STMT-4",
        public_values: pv({ ...c0, mode: 1, sig_bits: [2] }),
      },
    ],
  },
  link: {
    valid: [
      {
        name: "golden-v328 chunks 0, 1, 2",
        parent_root: manifest.parent_root,
        chunks: golden.map(pv),
        claim: {
          chain_id: manifest.chain_id,
          rollup_id: manifest.rollup_id,
          parent_root: manifest.parent_root,
          inbox_from: manifest.inbox_from,
          inbox_end: manifest.inbox_end,
          data_hash: manifest.data_hash,
          state_root: manifest.state_root,
          withdrawals_root: manifest.withdrawals_root,
          sig_mode: manifest.sig_mode,
          chunks: String(golden.length),
        },
      },
    ],
    invalid: [
      {
        name: "no chunks",
        rule: "STMT-5",
        parent_root: manifest.parent_root,
        chunks: [],
        error: "Empty",
      },
      {
        name: "first chunk starts after the parent",
        rule: "STMT-6",
        parent_root: manifest.parent_root,
        chunks: [pv(c1), pv(c2)],
        error: 'Broken(0, "start root is not the parent root")',
      },
      {
        name: "second chunk names another chain",
        rule: "STMT-7",
        parent_root: manifest.parent_root,
        chunks: [pv(c0), pv({ ...c1, chain_id: utf8.encode("qorechain-dianb") }), pv(c2)],
        error: 'Broken(1, "chain or rollup differs")',
      },
      {
        name: "second chunk names another rollup",
        rule: "STMT-7",
        parent_root: manifest.parent_root,
        chunks: [pv(c0), pv({ ...c1, rollup_id: utf8.encode("my-ledger-rollux") }), pv(c2)],
        error: 'Broken(1, "chain or rollup differs")',
      },
      {
        name: "second chunk uses the v0 signature mode",
        rule: "STMT-8",
        parent_root: manifest.parent_root,
        chunks: [pv(c0), pv({ ...c1, mode: 1 }), pv(c2)],
        error: 'Broken(1, "signature mode differs")',
      },
      {
        name: "middle chunk dropped",
        rule: "STMT-9",
        parent_root: manifest.parent_root,
        chunks: [pv(c0), pv(c2)],
        error: 'Broken(1, "start root is not the previous end root")',
      },
      {
        name: "second chunk skips one inbox entry",
        rule: "STMT-10",
        parent_root: manifest.parent_root,
        chunks: [pv(c0), pv({ ...c1, inbox_from: c1.inbox_from + 1n }), pv(c2)],
        error: 'Broken(1, "inbox range does not continue")',
      },
      {
        name: "second chunk starts from another accumulator",
        rule: "STMT-10",
        parent_root: manifest.parent_root,
        chunks: [pv(c0), pv({ ...c1, acc_from: flip(c1.acc_from) }), pv(c2)],
        error: 'Broken(1, "inbox range does not continue")',
      },
    ],
  },
  batch_input: {
    valid: [{ name: "one entry on an empty inbox", input: batchInput }],
    invalid: [
      { name: "unknown field", rule: "STMT-11", input: { ...batchInput, extra: "x" } },
      { name: "version 2", rule: "STMT-11", input: { ...batchInput, version: "2" } },
      {
        name: "leading zero in an integer",
        rule: "STMT-12",
        input: { ...batchInput, batch_index: "01" },
      },
      {
        name: "integer as a JSON number",
        rule: "STMT-12",
        input: { ...batchInput, inbox_from: 0 },
      },
      {
        name: "uppercase payload hex",
        rule: "STMT-12",
        input: {
          ...batchInput,
          entries: [{ height: "10", poster: "qor1poster", payload: "6E6F" }],
        },
      },
    ],
  },
});

schema("vectors/statement/batch-input.schema.json", BatchInputV1);

// ---------------------------------------------------------------------------
// QSTR v1.

const q: QstrV1 = {
  chainId: manifest.chain_id,
  rollupId: manifest.rollup_id,
  batchIndex: manifest.batch_index,
  inboxFrom: manifest.inbox_from,
  inboxEnd: manifest.inbox_end,
  prevStateRoot: manifest.parent_root,
  stateRoot: manifest.state_root,
  withdrawalsRoot: manifest.withdrawals_root,
  dataHash: manifest.data_hash,
  sigMode: manifest.sig_mode,
  programVkeyHash: manifest.program_vkey_hash,
  proverId: "sdiqt-golden",
  chunkCount: manifest.chunks.length,
  proofRoot: manifest.proof_root,
  manifestSha256: manifestSha256(manifest),
};
const qBytes = encodeQstrV1(q);
const committed = readFileSync(`${ROOT}vectors/qstr/golden-v328.hex`, "utf8").trim();
if (toHex(qBytes) !== committed) throw new Error("QSTR encoder no longer matches golden-v328.hex");

const sigAt = 5 + 1 + utf8.encode(q.chainId).length + 1 + utf8.encode(q.rollupId).length + 24 + 128;
const chunkCountAt = sigAt + 1 + 32 + 1 + utf8.encode(q.proverId).length;
const setByte = (at: number, v: number) => {
  const b = qBytes.slice();
  b[at] = v;
  return toHex(b);
};
const longest: QstrV1 = {
  ...q,
  chainId: "c".repeat(255),
  rollupId: "r".repeat(255),
  proverId: "p".repeat(255),
};
const emptyRoot: QstrV1 = { ...q, withdrawalsRoot: "" };
const big = (1n << 64n).toString();

json("vectors/qstr/cases.json", {
  ...header("specs/qstr-v1.md"),
  valid: [
    { name: "golden-v328, prover sdiqt-golden", hex: toHex(qBytes), qstr: q },
    { name: "batch without withdrawals", hex: toHex(encodeQstrV1(emptyRoot)), qstr: emptyRoot },
    {
      name: "every string at 255 bytes: 1,024 bytes",
      hex: toHex(encodeQstrV1(longest)),
      qstr: longest,
    },
  ],
  decode_invalid: [
    {
      name: "1,025 bytes",
      rule: "QSTR-1",
      hex: `${toHex(encodeQstrV1(longest))}00`,
      error: "the limit is 1024",
    },
    { name: "magic QSTS", rule: "QSTR-2", hex: setByte(3, 0x53), error: "not a QSTR commitment" },
    { name: "version 2", rule: "QSTR-3", hex: setByte(4, 2), error: "unsupported QSTR version 2" },
    { name: "chain_id length 0", rule: "QSTR-4", hex: setByte(5, 0), error: "chain_id is empty" },
    {
      name: "chain_id is not UTF-8",
      rule: "QSTR-5",
      hex: setByte(6, 0xff),
      error: "chain_id is not valid UTF-8",
    },
    {
      name: "sig_mode 0",
      rule: "QSTR-6",
      hex: setByte(sigAt, 0),
      error: "unknown sig_mode byte 0",
    },
    {
      name: "sig_mode 3",
      rule: "QSTR-6",
      hex: setByte(sigAt, 3),
      error: "unknown sig_mode byte 3",
    },
    {
      name: "chunk_count 0",
      rule: "QSTR-7",
      hex: toHex(
        (() => {
          const b = qBytes.slice();
          b[chunkCountAt] = 0;
          b[chunkCountAt + 1] = 0;
          return b;
        })(),
      ),
      error: "chunk_count is 0",
    },
    {
      name: "ends inside manifest_sha256",
      rule: "QSTR-8",
      hex: toHex(qBytes.subarray(0, qBytes.length - 1)),
      error: "QSTR ends inside manifest_sha256",
    },
    {
      name: "one trailing byte",
      rule: "QSTR-9",
      hex: `${toHex(qBytes)}00`,
      error: "1 trailing bytes",
    },
  ],
  encode_invalid: [
    {
      name: "batch_index 2^64",
      rule: "QSTR-10",
      qstr: { ...q, batchIndex: big },
      error: "does not fit in 64 bits",
    },
    {
      name: "inbox_end with a leading zero",
      rule: "QSTR-10",
      qstr: { ...q, inboxEnd: "014" },
      error: "is not a decimal string",
    },
    {
      name: "empty prover_id",
      rule: "QSTR-11",
      qstr: { ...q, proverId: "" },
      error: "prover_id must be 1 to 255 UTF-8 bytes",
    },
    {
      name: "prover_id of 256 bytes",
      rule: "QSTR-11",
      qstr: { ...q, proverId: "p".repeat(256) },
      error: "prover_id must be 1 to 255 UTF-8 bytes",
    },
    {
      name: "uppercase state_root",
      rule: "QSTR-12",
      qstr: { ...q, stateRoot: q.stateRoot.toUpperCase() },
      error: "state_root must be 32 bytes of lowercase hex",
    },
    {
      name: "chunk_count 0",
      rule: "QSTR-13",
      qstr: { ...q, chunkCount: 0 },
      error: "chunk_count 0 is outside 1..65535",
    },
    {
      name: "chunk_count 65536",
      rule: "QSTR-13",
      qstr: { ...q, chunkCount: 65536 },
      error: "chunk_count 65536 is outside 1..65535",
    },
    {
      name: "sig_mode name v1",
      rule: "QSTR-14",
      qstr: { ...q, sigMode: "v1" },
      error: "unknown sig_mode v1",
    },
  ],
  match_invalid: [
    {
      name: "state_root differs from the manifest",
      rule: "QSTR-15",
      qstr: { ...q, stateRoot: "11".repeat(32) },
      differs: ["state_root"],
    },
    {
      name: "batch_index differs from the manifest",
      rule: "QSTR-15",
      qstr: { ...q, batchIndex: "1" },
      differs: ["batch_index"],
    },
    {
      name: "chunk_count differs from the manifest",
      rule: "QSTR-15",
      qstr: { ...q, chunkCount: 2 },
      differs: ["chunk_count"],
    },
    {
      name: "manifest_sha256 names another manifest",
      rule: "QSTR-16",
      qstr: { ...q, manifestSha256: toHex(flip(fromHex(q.manifestSha256))) },
      differs: ["manifest_sha256"],
    },
  ],
  manifest: GOLDEN,
});

// ---------------------------------------------------------------------------
// Proof bundle v1.

const proofHashes = proofs.map((p) => toHex(sha256(p)));
type ProofSlot = { from: number; flip?: number };
const allSlots: ProofSlot[] = proofs.map((_, i) => ({ from: i }));
const mid = Math.floor((proofs[1]?.length ?? 0) / 2);
const slotHash = (s: ProofSlot) => {
  const p = proofs[s.from] as Uint8Array;
  return toHex(sha256(s.flip === undefined ? p : flip(p, s.flip)));
};

/** A manifest over these proof slots with indexes, file names, hashes and proof root rewritten. */
function reseal(slots: ProofSlot[], edit: Partial<BundleManifestV1> = {}) {
  const chunks = slots.map((s, i) => ({
    ...(manifest.chunks[s.from] as BundleManifestV1["chunks"][number]),
    index: String(i),
    file: `chunk-${i}.bin`,
    proof_sha256: slotHash(s),
  }));
  return { ...manifest, chunks, proof_root: proofRoot(chunks.map((c) => c.proof_sha256)), ...edit };
}
const text = (m: unknown) => canonicalize(m);
if (text(manifest) !== manifestText) throw new Error("golden manifest is not canonical");
if (proofRoot(proofHashes) !== manifest.proof_root) throw new Error("golden proof root differs");

const chainBatch = {
  batch_index: manifest.batch_index,
  inbox_start: manifest.inbox_from,
  inbox_end: manifest.inbox_end,
  prev_state_root: manifest.parent_root,
  state_root: manifest.state_root,
  withdrawals_root: manifest.withdrawals_root,
  data_hash: manifest.data_hash,
};

json("vectors/bundles/cases.json", {
  ...header("specs/bundle-v1.md"),
  bundle: GOLDEN,
  valid: [
    {
      name: "golden-v328, pinned to its program",
      manifest: manifestText,
      proofs: allSlots,
      vkey: manifest.program_vkey_hash,
      manifest_sha256: manifestSha256(manifest),
      chain_batch: chainBatch,
    },
  ],
  invalid: [
    {
      name: "version 2",
      rule: "BND-1",
      check: "verifier",
      manifest: text({ ...manifest, version: "2" }),
      proofs: allSlots,
      error: 'Field("manifest"',
    },
    {
      name: "unknown field",
      rule: "BND-1",
      check: "verifier",
      manifest: text({ ...manifest, extra: "x" }),
      proofs: allSlots,
      error: 'Field("manifest"',
    },
    {
      name: "pretty-printed manifest file",
      rule: "BND-2",
      check: "reader",
      manifest: `${JSON.stringify(JSON.parse(manifestText), null, 2)}\n`,
      error: "not in canonical form",
    },
    {
      name: "chunk file outside the chunk-N.bin pattern",
      rule: "BND-3",
      check: "schema",
      manifest: text({
        ...manifest,
        chunks: manifest.chunks.map((c, i) => (i === 0 ? { ...c, file: "../chunk-0.bin" } : c)),
      }),
    },
    {
      name: "no chunks",
      rule: "BND-3",
      check: "schema",
      manifest: text({ ...manifest, chunks: [] }),
    },
    {
      name: "uppercase state_root",
      rule: "BND-3",
      check: "schema",
      manifest: text({ ...manifest, state_root: manifest.state_root.toUpperCase() }),
    },
    {
      name: "another program pinned",
      rule: "BND-4",
      check: "verifier",
      manifest: manifestText,
      proofs: allSlots,
      vkey: "00".repeat(32),
      error: "WrongProgram",
    },
    {
      name: "two proofs for three chunks",
      rule: "BND-5",
      check: "verifier",
      manifest: manifestText,
      proofs: allSlots.slice(0, 2),
      error: "ChunkCount(3, 2)",
    },
    {
      name: "chunk indexes out of order",
      rule: "BND-6",
      check: "verifier",
      manifest: text({
        ...manifest,
        chunks: manifest.chunks.map((c, i) => (i === 1 ? { ...c, index: "2" } : c)),
      }),
      proofs: allSlots,
      error: 'ChunkOrder(1, "2")',
    },
    {
      name: "chunk 1 stored under another chunk's file name",
      rule: "BND-6",
      check: "verifier",
      manifest: text({
        ...manifest,
        chunks: manifest.chunks.map((c, i) => (i === 1 ? { ...c, file: "chunk-2.bin" } : c)),
      }),
      proofs: allSlots,
      error: 'Field("file", "chunk-2.bin")',
    },
    {
      name: "flipped proof byte",
      rule: "BND-7",
      check: "verifier",
      manifest: manifestText,
      proofs: [{ from: 0 }, { from: 1, flip: mid }, { from: 2 }],
      error: "ProofHash(1)",
    },
    {
      name: "flipped proof byte with matching hashes",
      rule: "BND-8",
      check: "verifier",
      manifest: text(reseal([{ from: 0 }, { from: 1, flip: mid }, { from: 2 }])),
      proofs: [{ from: 0 }, { from: 1, flip: mid }, { from: 2 }],
      error: "Proof(1,",
    },
    {
      name: "manifest names another verifying key",
      rule: "BND-8",
      check: "verifier",
      manifest: text({
        ...manifest,
        program_vkey_hash: toHex(flip(fromHex(manifest.program_vkey_hash))),
      }),
      proofs: allSlots,
      error: "Proof(0,",
    },
    {
      name: "proof root edited",
      rule: "BND-9",
      check: "verifier",
      manifest: text({ ...manifest, proof_root: "00".repeat(32) }),
      proofs: allSlots,
      error: "ProofRoot",
    },
    {
      name: "chunks 1 and 2 swapped",
      rule: "BND-10",
      check: "verifier",
      manifest: text(reseal([{ from: 0 }, { from: 2 }, { from: 1 }])),
      proofs: [{ from: 0 }, { from: 2 }, { from: 1 }],
      error: "Link(Broken(1,",
    },
    {
      name: "last chunk dropped",
      rule: "BND-11",
      check: "verifier",
      manifest: text(reseal([{ from: 0 }, { from: 1 }])),
      proofs: [{ from: 0 }, { from: 1 }],
      error: 'ClaimMismatch("inbox_end")',
    },
    {
      name: "state_root edited",
      rule: "BND-11",
      check: "verifier",
      manifest: text({ ...manifest, state_root: "11".repeat(32) }),
      proofs: allSlots,
      error: 'ClaimMismatch("state_root")',
    },
    {
      name: "sig_mode edited to v0",
      rule: "BND-11",
      check: "verifier",
      manifest: text({ ...manifest, sig_mode: "v0" }),
      proofs: allSlots,
      error: 'ClaimMismatch("sig_mode")',
    },
    {
      name: "chain batch at another index",
      rule: "BND-12",
      check: "chain",
      manifest: manifestText,
      chain_batch: { ...chainBatch, batch_index: "1" },
      differs: ["batch_index"],
    },
    {
      name: "chain batch with another parent root",
      rule: "BND-12",
      check: "chain",
      manifest: manifestText,
      chain_batch: { ...chainBatch, prev_state_root: "22".repeat(32) },
      differs: ["parent_root"],
    },
  ],
});
schema("vectors/bundles/manifest.schema.json", BundleManifestV1);

// ---------------------------------------------------------------------------
// Receipt v1. Signed deterministically (FIPS 204 without hedging) so the
// bytes are stable; a verifier cannot tell the difference.

const receiptKeys = keygen(new Uint8Array(32).fill(0x07));
const otherKeys = keygen(new Uint8Array(32).fill(0x08));
const signWith = (body: unknown, secretKey: Uint8Array, context: string) =>
  toHex(
    ml_dsa87.sign(canonicalBytes(body), secretKey, {
      context: utf8.encode(context),
      extraEntropy: false,
    }),
  );
const issuer = `dev:${toHex(sha256(receiptKeys.publicKey)).slice(0, 16)}`;
const body: ReceiptBodyV1 = {
  format: "sdiqt-receipt",
  version: "1",
  chain_id: manifest.chain_id,
  rollup_id: manifest.rollup_id,
  batch_index: manifest.batch_index,
  prev_state_root: manifest.parent_root,
  state_root: manifest.state_root,
  withdrawals_root: manifest.withdrawals_root,
  data_hash: manifest.data_hash,
  inbox_from: manifest.inbox_from,
  inbox_end: manifest.inbox_end,
  submit_tx: toHex(sha256(utf8.encode("sdiqt receipt vector: submit tx"))),
  submit_height: "1000",
  submitted_time: "2026-11-20T10:00:00.000Z",
  challenge_deadline: "2026-11-20T11:00:00.000Z",
  settlement: "final",
  validity: "proven",
  anchor: { layer_id: manifest.rollup_id, layer_height: manifest.batch_index },
  proof: {
    statement: "sdiqt-stmt-v1",
    sig_mode: q.sigMode,
    program_vkey_hash: q.programVkeyHash,
    prover_id: q.proverId,
    chunk_count: String(q.chunkCount),
    proof_root: q.proofRoot,
    qstr_sequence: "15",
    qstr_tx: toHex(sha256(utf8.encode("sdiqt receipt vector: qstr tx"))),
  },
  soundness_note: "Test vector receipt from packages/protocol/scripts/vectors.ts.",
  issued_height: "2000",
  issuer,
};
const pendingBody: ReceiptBodyV1 = {
  ...body,
  settlement: "pending",
  validity: "proving",
  proof: null,
};
const signed = (b: unknown) => ({
  body: b,
  signature: signWith(b, receiptKeys.secretKey, SIGNING_CONTEXTS.receiptV1),
});
const good = signed(body);
const withBody = (edit: Record<string, unknown>) => signed({ ...body, ...edit });

json("vectors/receipt/cases.json", {
  ...header("specs/receipt-v1.md"),
  public_key: toHex(receiptKeys.publicKey),
  seed: "07".repeat(32),
  valid: [
    { name: "final and proven", receipt: good },
    { name: "pending and proving, no proof yet", receipt: signed(pendingBody) },
  ],
  invalid: [
    {
      name: "unknown body field",
      rule: "RCPT-1",
      check: "schema",
      receipt: withBody({ extra: "x" }),
    },
    {
      name: "unknown top-level field",
      rule: "RCPT-1",
      check: "schema",
      receipt: { ...good, issued_at: "x" },
    },
    { name: "version 2", rule: "RCPT-2", check: "schema", receipt: withBody({ version: "2" }) },
    {
      name: "format sdiqt-receipts",
      rule: "RCPT-2",
      check: "schema",
      receipt: withBody({ format: "sdiqt-receipts" }),
    },
    {
      name: "leading zero in batch_index",
      rule: "RCPT-3",
      check: "schema",
      receipt: withBody({ batch_index: "00" }),
    },
    {
      name: "submit_height as a JSON number",
      rule: "RCPT-3",
      check: "schema",
      receipt: { ...good, body: { ...body, submit_height: 1000 } },
    },
    {
      name: "uppercase submit_tx",
      rule: "RCPT-4",
      check: "schema",
      receipt: withBody({ submit_tx: body.submit_tx.toUpperCase() }),
    },
    {
      name: "uppercase signature",
      rule: "RCPT-4",
      check: "schema",
      receipt: { ...good, signature: good.signature.toUpperCase() },
    },
    {
      name: "submitted_time without a time",
      rule: "RCPT-5",
      check: "schema",
      receipt: withBody({ submitted_time: "2026-11-20" }),
    },
    {
      name: "settlement finalized",
      rule: "RCPT-6",
      check: "schema",
      receipt: withBody({ settlement: "finalized" }),
    },
    {
      name: "validity valid",
      rule: "RCPT-6",
      check: "schema",
      receipt: withBody({ validity: "valid" }),
    },
    {
      name: "statement sdiqt-stmt-v2",
      rule: "RCPT-7",
      check: "schema",
      receipt: withBody({ proof: { ...body.proof, statement: "sdiqt-stmt-v2" } }),
    },
    {
      name: "state_root changed after signing",
      rule: "RCPT-8",
      check: "signature",
      receipt: { ...good, body: { ...body, state_root: "11".repeat(32) } },
    },
    {
      name: "settlement changed after signing",
      rule: "RCPT-8",
      check: "signature",
      receipt: { ...good, body: { ...body, settlement: "rejected" } },
    },
    {
      name: "signed under the exit packet context",
      rule: "RCPT-9",
      check: "signature",
      receipt: {
        body,
        signature: signWith(body, receiptKeys.secretKey, SIGNING_CONTEXTS.exitPacketV1),
      },
    },
    {
      name: "signed without a context",
      rule: "RCPT-9",
      check: "signature",
      receipt: {
        body,
        signature: toHex(
          ml_dsa87.sign(canonicalBytes(body), receiptKeys.secretKey, { extraEntropy: false }),
        ),
      },
    },
    {
      name: "signed by another key",
      rule: "RCPT-10",
      check: "signature",
      receipt: { body, signature: signWith(body, otherKeys.secretKey, SIGNING_CONTEXTS.receiptV1) },
    },
  ],
});
schema("vectors/receipt/receipt.schema.json", SignedReceiptV1);

// ---------------------------------------------------------------------------
// Exit packet v1: only the schemas here. Its intake vectors need the tower's
// QoreSeal keys and the qledger key derivation, so they come from
// `apps/watchtower/scripts/exit-vectors.ts`.

schema("vectors/exit-packet/packet.schema.json", ExitPacketV1);
schema("vectors/exit-packet/cancel.schema.json", ExitCancelV1);

// ---------------------------------------------------------------------------

const stale: string[] = [];
for (const [path, content] of outputs) {
  const abs = `${ROOT}${path}`;
  if (process.argv[2] === "--check") {
    let current: string | undefined;
    try {
      current = readFileSync(abs, "utf8");
    } catch {
      current = undefined;
    }
    if (current !== content) stale.push(path);
  } else {
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, content);
  }
}
for (const path of stale) console.error(`${path} is stale: run node ${GENERATOR}`);
process.exit(stale.length ? 1 : 0);
