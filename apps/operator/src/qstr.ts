/**
 * QSTR commitments: post one for a proven batch and find the ones already in
 * the archive. A post goes through `SafeTx` like every other send, and the
 * posted-data fee (per billable byte, at least 1 KiB) is reserved against the
 * spend cap next to the gas fee.
 */
import { postedDataHash, postRollupDataMsg, type RdkTxClient } from "@qorechain/rdk";
import type { InboxRecord } from "@sdiqt/archiver";
import type { SafeTx } from "@sdiqt/chain";
import {
  type BundleManifestV1,
  decodeQstrV1,
  encodeQstrV1,
  fromHex,
  type QstrV1,
  qstrFromManifest,
  toHex,
} from "@sdiqt/protocol";

type DeliverTxResponse = Awaited<ReturnType<RdkTxClient["postRollupData"]>>;

/** The chain bills posted data per byte with this floor. */
export const POSTED_DATA_MIN_BILLED_BYTES = 1024n;

export function postedDataFeeUqor(size: number, feePerByte: bigint): bigint {
  const billed =
    BigInt(size) > POSTED_DATA_MIN_BILLED_BYTES ? BigInt(size) : POSTED_DATA_MIN_BILLED_BYTES;
  return billed * feePerByte;
}

export interface QstrPostResult {
  txhash: string;
  height: number;
  /** Inbox sequence of the QSTR entry. */
  sequence: string;
  dataHash: string;
  bytes: number;
}

/** The QSTR bytes for a bundle manifest, with their data hash and size. */
export function prepareQstr(manifest: BundleManifestV1, proverId: string) {
  const qstr = qstrFromManifest(manifest, proverId);
  const bytes = encodeQstrV1(qstr);
  return { qstr, bytes, dataHash: toHex(postedDataHash(bytes)) };
}

/** Read the inbox sequence of our post from the delivered tx's events. */
export function postedSequence(tx: DeliverTxResponse, rollupId: string, dataHash: string): string {
  for (const ev of tx.events) {
    if (ev.type !== "rdk_data_posted") continue;
    const a = Object.fromEntries(ev.attributes.map((x) => [String(x.key), String(x.value)]));
    if (a.rollup_id === rollupId && a.data_hash?.toLowerCase() === dataHash) {
      if (!a.sequence) break;
      return a.sequence;
    }
  }
  throw new Error(`tx ${tx.transactionHash} has no rdk_data_posted event for ${dataHash}`);
}

export interface QstrPosterOptions {
  tx: RdkTxClient;
  safe: SafeTx;
  rollupId: string;
  /** `posted_data_fee_per_byte` from the chain params, in uqor. */
  feePerByte: bigint;
}

/** Post the QSTR of `manifest` and return where it landed. */
export async function postQstr(
  o: QstrPosterOptions,
  manifest: BundleManifestV1,
  proverId: string,
): Promise<QstrPostResult> {
  if (manifest.rollup_id !== o.rollupId) {
    throw new Error(`manifest is for ${manifest.rollup_id}, poster is for ${o.rollupId}`);
  }
  const { bytes, dataHash } = prepareQstr(manifest, proverId);
  const { tx } = await o.safe.run({
    label: `post QSTR for batch ${manifest.batch_index}`,
    messages: [postRollupDataMsg({ poster: o.tx.address, rollupId: o.rollupId, data: bytes })],
    amountUqor: postedDataFeeUqor(bytes.length, o.feePerByte),
    send: () => o.tx.postRollupData({ rollupId: o.rollupId, data: bytes }),
  });
  return {
    txhash: tx.transactionHash,
    height: tx.height,
    sequence: postedSequence(tx, o.rollupId, dataHash),
    dataHash,
    bytes: bytes.length,
  };
}

export interface ArchivedQstr {
  sequence: string;
  txhash: string;
  poster: string;
  qstr: QstrV1;
}

/**
 * Every well-formed QSTR in the archive posted by `poster`. Other posts that
 * start with "QSTR" but do not decode are skipped: anyone can post to a based
 * inbox, so only the poster makes a commitment ours.
 */
export function archivedQstrs(entries: InboxRecord[], poster: string): ArchivedQstr[] {
  const out: ArchivedQstr[] = [];
  for (const e of entries) {
    if (e.kind !== "post" || e.poster !== poster || !e.payload.startsWith("51535452")) continue;
    try {
      out.push({
        sequence: e.sequence,
        txhash: e.txhash,
        poster: e.poster,
        qstr: decodeQstrV1(fromHex(e.payload)),
      });
    } catch {
      // A malformed commitment from our own key is still not a commitment.
    }
  }
  return out;
}

/** Our QSTR for `batchIndex`, the first one posted if there are several. */
export function qstrForBatch(
  entries: InboxRecord[],
  poster: string,
  batchIndex: string,
): ArchivedQstr | undefined {
  return archivedQstrs(entries, poster).find((q) => q.qstr.batchIndex === batchIndex);
}
