/**
 * QSTR v1: the commitment an SDIQT operator posts to its own rollup inbox for
 * every proven batch. The bytes are spelled out in `specs/qstr-v1.md`.
 *
 * QSTR carries no inner signature. Its author is the poster of the hybrid-signed
 * `MsgPostRollupData`, and the inbox accumulator binds poster and data hash.
 * Its first byte, 0x51 ("Q"), is a no-op entry when qledger-v1 executes it.
 */
import { sha256 } from "@noble/hashes/sha2.js";
import { QSTR_MAX_BYTES, QSTR_VERSION } from "./constants.ts";
import { fromHex, toHex } from "./encoding.ts";
import { canonicalBytes } from "./jcs.ts";
import { BundleManifestV1 } from "./schemas.ts";

export const QSTR_MAGIC = new Uint8Array([0x51, 0x53, 0x54, 0x52]); // "QSTR"

/** Wire value of each signature mode. 0 is never valid. */
export const QSTR_SIG_MODES = { full: 1, v0: 2 } as const;
export type QstrSigMode = keyof typeof QSTR_SIG_MODES;

/** Domain tag of the proof root, shared with the Rust bundle code. */
export const PROOF_ROOT_TAG = "sdiqt/proofs/v1";

/** A decoded QSTR v1 commitment. Integers are decimal strings, bytes lowercase hex. */
export interface QstrV1 {
  chainId: string;
  rollupId: string;
  batchIndex: string;
  inboxFrom: string;
  inboxEnd: string;
  prevStateRoot: string;
  stateRoot: string;
  /** Empty when the batch has no withdrawals, as the chain records it. */
  withdrawalsRoot: string;
  dataHash: string;
  sigMode: QstrSigMode;
  programVkeyHash: string;
  proverId: string;
  chunkCount: number;
  proofRoot: string;
  /** SHA-256 of the bundle manifest's canonical (RFC 8785) bytes. */
  manifestSha256: string;
}

/**
 * A batch without withdrawals has an empty withdrawals root on chain. QSTR
 * writes it as 32 zero bytes and reads 32 zero bytes back as empty; no SHA-256
 * root is all zeros.
 */
const EMPTY_ROOT_BYTES = new Uint8Array(32);
const EMPTY_ROOT_HEX = "00".repeat(32);

export class QstrError extends Error {
  override readonly name = "QstrError";
}

const utf8 = new TextEncoder();
const utf8Strict = new TextDecoder("utf-8", { fatal: true });
const U64_MAX = (1n << 64n) - 1n;

/** `SHA-256("sdiqt/proofs/v1" | be16 n | sha256(proof_1) | ... | sha256(proof_n))`. */
export function proofRoot(proofSha256: string[]): string {
  if (proofSha256.length === 0 || proofSha256.length > 0xffff) {
    throw new QstrError(`a proof root needs 1 to 65535 proofs, got ${proofSha256.length}`);
  }
  const parts: Uint8Array[] = [
    utf8.encode(PROOF_ROOT_TAG),
    new Uint8Array([proofSha256.length >> 8, proofSha256.length & 0xff]),
  ];
  for (const h of proofSha256) parts.push(hash32(h, "proof hash"));
  return toHex(sha256(concat(parts)));
}

/** SHA-256 of a bundle manifest's canonical bytes, the value QSTR commits to. */
export function manifestSha256(manifest: BundleManifestV1): string {
  return toHex(sha256(canonicalBytes(BundleManifestV1.parse(manifest))));
}

/** The QSTR for a bundle manifest. Checks that the manifest's proof root matches its chunks. */
export function qstrFromManifest(manifest: BundleManifestV1, proverId: string): QstrV1 {
  const m = BundleManifestV1.parse(manifest);
  const root = proofRoot(m.chunks.map((c) => c.proof_sha256));
  if (root !== m.proof_root) {
    throw new QstrError(`manifest proof_root ${m.proof_root} differs from its chunks (${root})`);
  }
  return {
    chainId: m.chain_id,
    rollupId: m.rollup_id,
    batchIndex: m.batch_index,
    inboxFrom: m.inbox_from,
    inboxEnd: m.inbox_end,
    prevStateRoot: m.parent_root,
    stateRoot: m.state_root,
    withdrawalsRoot: m.withdrawals_root,
    dataHash: m.data_hash,
    sigMode: m.sig_mode,
    programVkeyHash: m.program_vkey_hash,
    proverId,
    chunkCount: m.chunks.length,
    proofRoot: m.proof_root,
    manifestSha256: manifestSha256(m),
  };
}

export function encodeQstrV1(q: QstrV1): Uint8Array {
  const sig = QSTR_SIG_MODES[q.sigMode];
  if (sig === undefined) throw new QstrError(`unknown sig_mode ${String(q.sigMode)}`);
  if (!Number.isInteger(q.chunkCount) || q.chunkCount < 1 || q.chunkCount > 0xffff) {
    throw new QstrError(`chunk_count ${q.chunkCount} is outside 1..65535`);
  }
  const out = concat([
    QSTR_MAGIC,
    new Uint8Array([Number(QSTR_VERSION)]),
    lp(q.chainId, "chain_id"),
    lp(q.rollupId, "rollup_id"),
    be64(q.batchIndex, "batch_index"),
    be64(q.inboxFrom, "inbox_from"),
    be64(q.inboxEnd, "inbox_end"),
    hash32(q.prevStateRoot, "prev_state_root"),
    hash32(q.stateRoot, "state_root"),
    q.withdrawalsRoot === "" ? EMPTY_ROOT_BYTES : hash32(q.withdrawalsRoot, "withdrawals_root"),
    hash32(q.dataHash, "data_hash"),
    new Uint8Array([sig]),
    hash32(q.programVkeyHash, "program_vkey_hash"),
    lp(q.proverId, "prover_id"),
    new Uint8Array([q.chunkCount >> 8, q.chunkCount & 0xff]),
    hash32(q.proofRoot, "proof_root"),
    hash32(q.manifestSha256, "manifest_sha256"),
  ]);
  if (BigInt(out.length) > QSTR_MAX_BYTES) {
    throw new QstrError(`QSTR is ${out.length} bytes, the limit is ${QSTR_MAX_BYTES}`);
  }
  return out;
}

/** Decode QSTR v1 bytes. Refuses another magic or version, unknown modes and trailing bytes. */
export function decodeQstrV1(bytes: Uint8Array): QstrV1 {
  if (BigInt(bytes.length) > QSTR_MAX_BYTES) {
    throw new QstrError(`QSTR is ${bytes.length} bytes, the limit is ${QSTR_MAX_BYTES}`);
  }
  const r = new Reader(bytes);
  const magic = r.take(4, "magic");
  if (!magic.every((b, i) => b === QSTR_MAGIC[i])) throw new QstrError("not a QSTR commitment");
  const version = r.u8("version");
  if (BigInt(version) !== QSTR_VERSION) throw new QstrError(`unsupported QSTR version ${version}`);
  const chainId = r.lp("chain_id");
  const rollupId = r.lp("rollup_id");
  const batchIndex = r.be64("batch_index");
  const inboxFrom = r.be64("inbox_from");
  const inboxEnd = r.be64("inbox_end");
  const prevStateRoot = r.hex32("prev_state_root");
  const stateRoot = r.hex32("state_root");
  const withdrawalsHex = r.hex32("withdrawals_root");
  const withdrawalsRoot = withdrawalsHex === EMPTY_ROOT_HEX ? "" : withdrawalsHex;
  const dataHash = r.hex32("data_hash");
  const sigByte = r.u8("sig_mode");
  const sigMode = (Object.keys(QSTR_SIG_MODES) as QstrSigMode[]).find(
    (k) => QSTR_SIG_MODES[k] === sigByte,
  );
  if (!sigMode) throw new QstrError(`unknown sig_mode byte ${sigByte}`);
  const programVkeyHash = r.hex32("program_vkey_hash");
  const proverId = r.lp("prover_id");
  const chunkCount = (r.u8("chunk_count") << 8) | r.u8("chunk_count");
  if (chunkCount === 0) throw new QstrError("chunk_count is 0");
  const proofRootHex = r.hex32("proof_root");
  const manifestHex = r.hex32("manifest_sha256");
  if (!r.done()) throw new QstrError(`${bytes.length - r.offset} trailing bytes`);
  return {
    chainId,
    rollupId,
    batchIndex,
    inboxFrom,
    inboxEnd,
    prevStateRoot,
    stateRoot,
    withdrawalsRoot,
    dataHash,
    sigMode,
    programVkeyHash,
    proverId,
    chunkCount,
    proofRoot: proofRootHex,
    manifestSha256: manifestHex,
  };
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

function lp(s: string, field: string): Uint8Array {
  const b = utf8.encode(s);
  if (b.length === 0 || b.length > 0xff) {
    throw new QstrError(`${field} must be 1 to 255 UTF-8 bytes, got ${b.length}`);
  }
  return concat([new Uint8Array([b.length]), b]);
}

function be64(dec: string, field: string): Uint8Array {
  if (!/^(0|[1-9][0-9]*)$/.test(dec))
    throw new QstrError(`${field} ${dec} is not a decimal string`);
  const v = BigInt(dec);
  if (v > U64_MAX) throw new QstrError(`${field} ${dec} does not fit in 64 bits`);
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, v);
  return out;
}

function hash32(hex: string, field: string): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(hex))
    throw new QstrError(`${field} must be 32 bytes of lowercase hex`);
  return fromHex(hex);
}

class Reader {
  offset = 0;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }
  take(n: number, field: string): Uint8Array {
    if (this.offset + n > this.bytes.length) throw new QstrError(`QSTR ends inside ${field}`);
    const out = this.bytes.subarray(this.offset, this.offset + n);
    this.offset += n;
    return out;
  }
  u8(field: string): number {
    return this.take(1, field)[0] as number;
  }
  lp(field: string): string {
    const n = this.u8(field);
    if (n === 0) throw new QstrError(`${field} is empty`);
    try {
      return utf8Strict.decode(this.take(n, field));
    } catch (err) {
      if (err instanceof QstrError) throw err;
      throw new QstrError(`${field} is not valid UTF-8`);
    }
  }
  be64(field: string): string {
    const b = this.take(8, field);
    return new DataView(b.buffer, b.byteOffset, 8).getBigUint64(0).toString();
  }
  hex32(field: string): string {
    return toHex(this.take(32, field));
  }
  done(): boolean {
    return this.offset === this.bytes.length;
  }
}
