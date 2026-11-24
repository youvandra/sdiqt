/**
 * The watchtower loop. Each tick it catches the archive up, then for every
 * archived batch submission: re-executes it, reads its settlement from the
 * chain (or from its anchor once the record is pruned), checks the STARK
 * bundle named by our QSTR, and issues a new signed receipt whenever the
 * batch's settlement or validity changes.
 */
import { type BatchRecord, readArchive } from "@sdiqt/archiver";
import { archivedQstrs, InboxReplay, type LogEvent } from "@sdiqt/operator";
import {
  type ApiProofClaim,
  type BundleManifestV1,
  PROVER_PROOF_DEADLINE_S,
  type ReceiptBodyV1,
} from "@sdiqt/protocol";
import { type BundleVerdict, manifestVsBatch, qstrVsManifest, verifyBundle } from "@sdiqt/verify";
import { type BundleSource, bundleName } from "./bundles.ts";
import type { TowerChain } from "./chain-view.ts";
import { judgeBatch } from "./judge.ts";
import { receiptState, SOUNDNESS_NOTE, signReceipt } from "./receipt.ts";
import { type ChainRecord, type Settlement, settle, validity } from "./settle.ts";
import type { BatchRow, TowerStore } from "./store.ts";

export interface TowerOptions {
  chainId: string;
  rollupId: string;
  archiveDir: string;
  chain: TowerChain;
  store: TowerStore;
  bundles: BundleSource;
  /** The operator address whose QSTR posts name our bundles. */
  operator: string;
  /** Pin the SP1 program; without it each manifest's key is used. */
  vkeyHash?: string;
  signer: { issuer: string; secretKey: Uint8Array };
  /** Catch the archive up; a lagging index is logged and the old archive used. */
  refreshArchive: () => Promise<void>;
  log: (e: LogEvent) => void;
  verify?: (json: string, proofs: Uint8Array[], vkey?: string) => BundleVerdict;
  now?: () => Date;
}

const key = (b: BatchRecord) => `${b.txhash}:${b.msg_index}`;
const iso = (unix: number) => new Date(unix * 1000).toISOString().replace(".000Z", "Z");

export class Tower {
  private readonly o: TowerOptions;
  private readonly replay: InboxReplay;

  constructor(o: TowerOptions) {
    this.o = o;
    this.replay = new InboxReplay(o.chainId, o.rollupId);
  }

  private nowDate(): Date {
    return this.o.now ? this.o.now() : new Date();
  }

  private nowUnix(): number {
    return Math.floor(this.nowDate().getTime() / 1000);
  }

  async tick(): Promise<{ batches: number; receipts: number }> {
    const { chain, store, rollupId, chainId, log } = this.o;
    try {
      await this.o.refreshArchive();
    } catch (err) {
      log({ event: "archive_stale", error: String(err) });
    }
    const { entries, batches } = await readArchive(this.o.archiveDir);
    this.replay.setEntries(entries);
    const [tip, retention, windowSec, anchors] = await Promise.all([
      chain.tip(),
      chain.retentionBlocks(),
      chain.challengeWindowSec(rollupId),
      chain.anchors(rollupId),
    ]);
    const qstrs = archivedQstrs(entries, this.o.operator);
    let issued = 0;

    // Inbox order keeps the replay moving forward except across rollbacks.
    const ordered = [...batches].sort(
      (a, b) =>
        Number(BigInt(a.inbox_start) - BigInt(b.inbox_start)) ||
        Number(BigInt(a.height) - BigInt(b.height)),
    );
    for (const b of ordered) {
      const k = key(b);
      const prev = store.get(k);
      if (prev && isTerminal(prev)) {
        // Rows stored before roots were kept get them once; nothing else changes.
        if (prev.state_root === null) store.put({ ...prev, ...rootsOf(b) });
        continue;
      }

      const judged = prev
        ? { match: prev.judged === "match", differs: JSON.parse(prev.differs) as string[] }
        : judgeBatch(this.replay, chainId, rollupId, b);
      // A settled batch stays settled: no chain read needed.
      const settled = prev?.settlement === "final" || prev?.settlement === "rejected";
      const record: ChainRecord = settled
        ? { kind: "missing" }
        : await chain.batch(rollupId, b.batch_index);
      const anchor = anchors.find(
        (a) => String(a.layerHeight) === b.batch_index && a.stateRoot === b.state_root,
      );
      const supersededLater = batches.some(
        (o) => o.batch_index === b.batch_index && BigInt(o.height) > BigInt(b.height),
      );
      const s = settled
        ? { settlement: prev.settlement as Settlement, pruned: prev.pruned === 1 }
        : settle({
            stateRoot: b.state_root,
            withdrawalsRoot: b.withdrawals_root,
            dataHash: b.data_hash,
            height: BigInt(b.height),
            record,
            supersededLater,
            anchored: anchor !== undefined,
            tipHeight: tip,
            retentionBlocks: retention,
            previous: prev?.settlement as Settlement | undefined,
          });
      const submittedTime =
        (record.kind === "found" && record.submittedTime > 0 ? record.submittedTime : undefined) ??
        prev?.submitted_time ??
        anchor?.anchoredAt ??
        null;

      // Proof: our QSTR for exactly these roots, its bundle verified and matched.
      const q = qstrs.find(
        (x) =>
          x.qstr.batchIndex === b.batch_index &&
          x.qstr.stateRoot === b.state_root &&
          x.qstr.inboxEnd === b.inbox_end,
      );
      let proven = prev?.validity === "proven";
      let bundleMs = prev?.bundle_ms ?? null;
      let claim: string | null = prev?.claim ?? null;
      let note: string | null = null;
      if (!proven && q && judged.match) {
        const bundle = await this.o.bundles(bundleName(b.batch_index, b.txhash));
        if (!bundle) note = "QSTR posted, bundle not reachable yet";
        else {
          const v = (this.o.verify ?? verifyBundle)(
            bundle.manifestJson,
            bundle.proofs,
            this.o.vkeyHash,
          );
          const diff = [
            ...qstrVsManifest(q.qstr, bundle.manifest).map((f) => `qstr.${f}`),
            ...manifestVsBatch(bundle.manifest, b).map((f) => `chain.${f}`),
          ];
          bundleMs = Math.round(v.ms);
          claim = JSON.stringify(claimOf(bundle.manifest, v.valid, bundleMs));
          if (!v.valid) note = `bundle INVALID: ${v.error}`;
          else if (diff.length) note = `bundle VALID but differs: ${diff.join(", ")}`;
          else proven = true;
          log({
            event: "bundle_checked",
            batch_index: b.batch_index,
            valid: v.valid,
            ms: bundleMs,
            differs: diff,
          });
        }
      }
      const deadline = (submittedTime ?? this.nowUnix()) + Number(PROVER_PROOF_DEADLINE_S);
      const val = validity({ mismatch: !judged.match, proven, now: this.nowUnix(), deadline });

      const row: BatchRow = {
        key: k,
        rollup_id: rollupId,
        batch_index: b.batch_index,
        txhash: b.txhash,
        height: b.height,
        submitter: b.sequencer,
        inbox: `${b.inbox_start}..${b.inbox_end}`,
        judged: judged.match ? "match" : "mismatch",
        differs: JSON.stringify(judged.differs),
        settlement: s.settlement,
        validity: val,
        pruned: s.pruned ? 1 : 0,
        submitted_time: submittedTime,
        qstr_tx: q?.txhash ?? null,
        bundle_ms: bundleMs,
        note,
        updated_at: this.nowDate().toISOString(),
        ...rootsOf(b),
        claim,
      };

      if (!anchor) row.note = note ?? "no anchor for this batch: no receipt";
      else if (s.settlement === "unknown") row.note = note ?? "settlement unknown: no receipt";
      else if (submittedTime === null) row.note = note ?? "submission time unknown: no receipt";
      else {
        const body: ReceiptBodyV1 = {
          format: "sdiqt-receipt",
          version: "1",
          chain_id: chainId,
          rollup_id: rollupId,
          batch_index: b.batch_index,
          prev_state_root: b.prev_state_root,
          state_root: b.state_root,
          withdrawals_root: b.withdrawals_root,
          data_hash: b.data_hash,
          inbox_from: b.inbox_start,
          inbox_end: b.inbox_end,
          submit_tx: b.txhash.toLowerCase(),
          submit_height: b.height,
          submitted_time: iso(submittedTime),
          challenge_deadline: iso(submittedTime + windowSec),
          settlement: s.settlement,
          validity: val,
          anchor: { layer_id: rollupId, layer_height: b.batch_index },
          proof:
            proven && q
              ? {
                  statement: "sdiqt-stmt-v1",
                  sig_mode: q.qstr.sigMode,
                  program_vkey_hash: q.qstr.programVkeyHash,
                  prover_id: q.qstr.proverId,
                  chunk_count: String(q.qstr.chunkCount),
                  proof_root: q.qstr.proofRoot,
                  qstr_sequence: q.sequence,
                  qstr_tx: q.txhash.toLowerCase(),
                }
              : null,
          soundness_note: SOUNDNESS_NOTE,
          issued_height: tip.toString(),
          issuer: this.o.signer.issuer,
        };
        const state = receiptState(body);
        if (store.latestReceipt(k)?.state !== state) {
          const signed = signReceipt(body, this.o.signer.secretKey);
          store.addReceipt(k, state, signed, row.updated_at);
          issued += 1;
          log({
            event: "receipt",
            batch_index: b.batch_index,
            txhash: b.txhash,
            settlement: s.settlement,
            validity: val,
            pruned: s.pruned,
          });
        }
      }
      if (!judged.match && !prev) {
        log({
          event: "mismatch",
          alert: true,
          batch_index: b.batch_index,
          txhash: b.txhash,
          differs: judged.differs,
        });
      }
      store.put(row);
    }
    store.setPoll(rollupId, {
      at: this.nowDate().toISOString(),
      height: tip.toString(),
    });
    return { batches: batches.length, receipts: issued };
  }
}

const rootsOf = (b: BatchRecord) => ({
  prev_state_root: b.prev_state_root,
  state_root: b.state_root,
  withdrawals_root: b.withdrawals_root,
  data_hash: b.data_hash,
});

/** What a checked bundle claims, kept for the explorer's side-by-side view. */
function claimOf(m: BundleManifestV1, verified: boolean, ms: number): ApiProofClaim {
  return {
    parent_root: m.parent_root,
    state_root: m.state_root,
    withdrawals_root: m.withdrawals_root,
    data_hash: m.data_hash,
    sig_mode: m.sig_mode,
    program_vkey_hash: m.program_vkey_hash,
    proof_root: m.proof_root,
    verified,
    verify_ms: String(ms),
    chunks: m.chunks.map((c) => ({ index: c.index, proof_sha256: c.proof_sha256 })),
  };
}

/** Nothing about a batch can change once it is settled and its validity is decided. */
function isTerminal(r: BatchRow): boolean {
  return (
    (r.settlement === "final" || r.settlement === "rejected") &&
    (r.validity === "proven" || r.validity === "mismatch")
  );
}
