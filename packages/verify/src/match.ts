/**
 * Field-by-field matches between a bundle manifest, the chain's batch and a
 * QSTR commitment. Each returns the names of the fields that differ, so a
 * caller can show exactly what is wrong; an empty list means they agree.
 */
import { type BundleManifestV1, manifestSha256, type QstrV1 } from "@sdiqt/protocol";

/** The batch fields the chain records, as the archiver writes them. */
export interface ChainBatch {
  batch_index: string;
  inbox_start: string;
  inbox_end: string;
  prev_state_root: string;
  state_root: string;
  withdrawals_root: string;
  data_hash: string;
}

const BATCH_FIELDS = [
  ["parent_root", "prev_state_root"],
  ["state_root", "state_root"],
  ["withdrawals_root", "withdrawals_root"],
  ["data_hash", "data_hash"],
  ["inbox_from", "inbox_start"],
  ["inbox_end", "inbox_end"],
  ["batch_index", "batch_index"],
] as const;

/** Fields where a bundle manifest disagrees with the chain's batch. */
export function manifestVsBatch(m: BundleManifestV1, b: ChainBatch): string[] {
  return BATCH_FIELDS.filter(([mk, bk]) => m[mk] !== b[bk]).map(([mk]) => mk);
}

/** Fields where a QSTR disagrees with the bundle it names. */
export function qstrVsManifest(q: QstrV1, m: BundleManifestV1): string[] {
  const pairs: Array<[string, unknown, unknown]> = [
    ["chain_id", q.chainId, m.chain_id],
    ["rollup_id", q.rollupId, m.rollup_id],
    ["batch_index", q.batchIndex, m.batch_index],
    ["inbox_from", q.inboxFrom, m.inbox_from],
    ["inbox_end", q.inboxEnd, m.inbox_end],
    ["prev_state_root", q.prevStateRoot, m.parent_root],
    ["state_root", q.stateRoot, m.state_root],
    ["withdrawals_root", q.withdrawalsRoot, m.withdrawals_root],
    ["data_hash", q.dataHash, m.data_hash],
    ["sig_mode", q.sigMode, m.sig_mode],
    ["program_vkey_hash", q.programVkeyHash, m.program_vkey_hash],
    ["chunk_count", q.chunkCount, m.chunks.length],
    ["proof_root", q.proofRoot, m.proof_root],
    ["manifest_sha256", q.manifestSha256, manifestSha256(m)],
  ];
  return pairs.filter(([, a, b]) => a !== b).map(([k]) => k);
}
