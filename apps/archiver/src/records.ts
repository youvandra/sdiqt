/**
 * Archive records for one rollup, read from the chain's transaction index.
 *
 * The chain keeps the inbox accumulator only at retained posts and its tx
 * index reaches back about 29 days, so the archive is the canonical copy of
 * every inbox entry and batch. Records are plain JSON with string integers
 * and are sorted, so the same chain history always gives the same bytes.
 */

import {
  base64ToBytes,
  bytesToHex,
  encodeQledgerDeposit,
  hexToBytes,
  postedDataHash,
  QLEDGER_DEPOSIT_POSTER_PREFIX,
} from "@qorechain/rdk";

export const ARCHIVE_VERSION = 1;

export const POST_EVENT = "rdk_data_posted";
export const DEPOSIT_EVENT = "rdk_rollup_deposit";
export const BATCH_EVENT = "rdk_inbox_consumed";

const POST_MSG = "/qorechain.rdk.v1.MsgPostRollupData";
const BATCH_MSG = "/qorechain.rdk.v1.MsgSubmitBatch";

/** One inbox entry: a posted payload or a deposit, in the form qledger replays. */
export interface InboxRecord {
  v: typeof ARCHIVE_VERSION;
  kind: "post" | "deposit";
  sequence: string;
  height: string;
  txhash: string;
  /** The poster the accumulator commits to (`deposit:<depositor>` for deposits). */
  poster: string;
  /** SHA-256 of `payload`, hex. */
  data_hash: string;
  /** The entry bytes, lowercase hex. */
  payload: string;
}

/** One submitted batch, with its roots as lowercase hex. */
export interface BatchRecord {
  v: typeof ARCHIVE_VERSION;
  kind: "batch";
  batch_index: string;
  height: string;
  txhash: string;
  msg_index: string;
  sequencer: string;
  inbox_start: string;
  inbox_end: string;
  tx_count: string;
  prev_state_root: string;
  state_root: string;
  withdrawals_root: string;
  data_hash: string;
}

/** The slice of a REST `tx_responses` item the archiver reads. */
export interface TxResponse {
  height?: string | number;
  txhash?: string;
  code?: number;
  tx?: { body?: { messages?: Array<Record<string, unknown>> } };
  events?: Array<{ type: string; attributes?: Array<{ key: unknown; value?: unknown }> }>;
}

export class ArchiveError extends Error {
  override readonly name = "ArchiveError";
}

function attrs(ev: {
  attributes?: Array<{ key: unknown; value?: unknown }>;
}): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of ev.attributes ?? []) out[String(a.key)] = String(a.value ?? "");
  return out;
}

function need(a: Record<string, string>, key: string, where: string): string {
  const v = a[key];
  if (v === undefined || v === "")
    throw new ArchiveError(`${where}: event attribute ${key} is missing`);
  return v;
}

function intString(v: unknown, where: string): string {
  const s = String(v ?? "");
  if (!/^(0|[1-9][0-9]*)$/.test(s))
    throw new ArchiveError(`${where}: ${JSON.stringify(v)} is not an integer`);
  return s;
}

const b64Hex = (v: unknown): string => (v ? bytesToHex(base64ToBytes(String(v))) : "");

function okTxs(txs: TxResponse[]): TxResponse[] {
  return txs.filter((t) => (t.code ?? 0) === 0);
}

/** Inbox entries of `rollupId` from transactions that emitted `rdk_data_posted`. */
export function postRecords(rollupId: string, txs: TxResponse[]): InboxRecord[] {
  const out: InboxRecord[] = [];
  for (const tx of okTxs(txs)) {
    const txhash = String(tx.txhash ?? "");
    const height = intString(tx.height, txhash);
    const msgs = tx.tx?.body?.messages ?? [];
    for (const ev of tx.events ?? []) {
      if (ev.type !== POST_EVENT) continue;
      const a = attrs(ev);
      if (a.rollup_id !== rollupId) continue;
      const where = `post in ${txhash}`;
      const sequence = intString(need(a, "sequence", where), where);
      const poster = need(a, "poster", where);
      const dataHash = need(a, "data_hash", where).toLowerCase();
      const candidates =
        a.msg_index !== undefined
          ? [msgs[Number(a.msg_index)]]
          : msgs.filter((m) => m["@type"] === POST_MSG);
      const msg = candidates.find(
        (m) =>
          m !== undefined &&
          m["@type"] === POST_MSG &&
          String(m.poster) === poster &&
          bytesToHex(postedDataHash(base64ToBytes(String(m.data ?? "")))) === dataHash,
      );
      if (!msg)
        throw new ArchiveError(`${where}: no message carries a payload with data_hash ${dataHash}`);
      out.push({
        v: ARCHIVE_VERSION,
        kind: "post",
        sequence,
        height,
        txhash,
        poster,
        data_hash: dataHash,
        payload: b64Hex(msg.data),
      });
    }
  }
  return out;
}

/** Inbox entries of `rollupId` from transactions that emitted `rdk_rollup_deposit`. */
export function depositRecords(rollupId: string, txs: TxResponse[]): InboxRecord[] {
  const out: InboxRecord[] = [];
  for (const tx of okTxs(txs)) {
    const txhash = String(tx.txhash ?? "");
    const height = intString(tx.height, txhash);
    for (const ev of tx.events ?? []) {
      if (ev.type !== DEPOSIT_EVENT) continue;
      const a = attrs(ev);
      if (a.rollup_id !== rollupId) continue;
      const where = `deposit in ${txhash}`;
      const amount = BigInt(intString(need(a, "amount", where).replace(/uqor$/, ""), where));
      const payload = encodeQledgerDeposit(hexToBytes(need(a, "account", where)), amount);
      out.push({
        v: ARCHIVE_VERSION,
        kind: "deposit",
        sequence: intString(need(a, "sequence", where), where),
        height,
        txhash,
        poster: QLEDGER_DEPOSIT_POSTER_PREFIX + need(a, "depositor", where),
        data_hash: bytesToHex(postedDataHash(payload)),
        payload: bytesToHex(payload),
      });
    }
  }
  return out;
}

/** Batches of `rollupId` from transactions that emitted `rdk_inbox_consumed`. */
export function batchRecords(rollupId: string, txs: TxResponse[]): BatchRecord[] {
  const out: BatchRecord[] = [];
  for (const tx of okTxs(txs)) {
    const txhash = String(tx.txhash ?? "");
    const height = intString(tx.height, txhash);
    const msgs = tx.tx?.body?.messages ?? [];
    for (const ev of tx.events ?? []) {
      if (ev.type !== BATCH_EVENT) continue;
      const a = attrs(ev);
      if (a.rollup_id !== rollupId) continue;
      const where = `batch in ${txhash}`;
      const msgIndex = intString(a.msg_index ?? "0", where);
      const msg = msgs[Number(msgIndex)];
      if (!msg || msg["@type"] !== BATCH_MSG || String(msg.rollup_id) !== rollupId) {
        throw new ArchiveError(
          `${where}: message ${msgIndex} is not a MsgSubmitBatch for ${rollupId}`,
        );
      }
      const batchIndex = intString(need(a, "batch_index", where), where);
      if (String(msg.batch_index) !== batchIndex) {
        throw new ArchiveError(
          `${where}: event batch_index ${batchIndex} differs from the message`,
        );
      }
      out.push({
        v: ARCHIVE_VERSION,
        kind: "batch",
        batch_index: batchIndex,
        height,
        txhash,
        msg_index: msgIndex,
        sequencer: String(msg.sequencer ?? ""),
        inbox_start: intString(need(a, "inbox_start", where), where),
        inbox_end: intString(need(a, "inbox_end", where), where),
        tx_count: intString(msg.tx_count, where),
        prev_state_root: b64Hex(msg.prev_state_root),
        state_root: b64Hex(msg.state_root),
        withdrawals_root: b64Hex(msg.withdrawals_root),
        data_hash: b64Hex(msg.data_hash),
      });
    }
  }
  return out;
}

const cmpBig = (a: string, b: string): number => {
  const x = BigInt(a);
  const y = BigInt(b);
  return x < y ? -1 : x > y ? 1 : 0;
};

/**
 * Merge inbox entries by sequence. The same sequence seen twice must carry the
 * same entry: anything else means the archive or the node is wrong, so it throws.
 */
export function mergeInbox(...lists: InboxRecord[][]): InboxRecord[] {
  const bySeq = new Map<string, InboxRecord>();
  for (const r of lists.flat()) {
    const prev = bySeq.get(r.sequence);
    if (prev && JSON.stringify(prev) !== JSON.stringify(r)) {
      throw new ArchiveError(`inbox entry ${r.sequence} was read twice with different contents`);
    }
    bySeq.set(r.sequence, r);
  }
  return [...bySeq.values()].sort((a, b) => cmpBig(a.sequence, b.sequence));
}

/** Merge batches by transaction and message, ordered by height then message. */
export function mergeBatches(...lists: BatchRecord[][]): BatchRecord[] {
  const byKey = new Map<string, BatchRecord>();
  for (const r of lists.flat()) {
    const key = `${r.txhash}:${r.msg_index}`;
    const prev = byKey.get(key);
    if (prev && JSON.stringify(prev) !== JSON.stringify(r)) {
      throw new ArchiveError(`batch ${key} was read twice with different contents`);
    }
    byKey.set(key, r);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      cmpBig(a.height, b.height) ||
      cmpBig(a.msg_index, b.msg_index) ||
      a.txhash.localeCompare(b.txhash),
  );
}

/** Sequences missing from 1..max, so a caller can tell a gap from a short archive. */
export function inboxGaps(entries: InboxRecord[]): string[] {
  const have = new Set(entries.map((e) => e.sequence));
  const last = entries.at(-1);
  const gaps: string[] = [];
  if (!last) return gaps;
  for (let s = 1n; s <= BigInt(last.sequence); s++)
    if (!have.has(s.toString())) gaps.push(s.toString());
  return gaps;
}

export const toJsonl = (records: object[]): string =>
  records.map((r) => `${JSON.stringify(r)}\n`).join("");

export function fromJsonl<T>(text: string): T[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}
