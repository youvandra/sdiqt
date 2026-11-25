/**
 * The watchtower loop. Each tick it catches the archive up, then for every
 * archived batch submission: re-executes it, reads its settlement from the
 * chain (or from its anchor once the record is pruned), checks the STARK
 * bundle named by our QSTR, and issues a new signed receipt whenever the
 * batch's settlement or validity changes. A submission whose re-execution
 * disagrees with the chain is challenged (see challenge.ts), and every
 * pending batch an upheld challenge rolls back is marked rejected (VOID).
 */
import { type BatchRecord, readArchive } from "@sdiqt/archiver";
import { archivedQstrs, type BatchPlan, InboxReplay, type LogEvent } from "@sdiqt/operator";
import {
  type ApiProofClaim,
  type BundleManifestV1,
  PROVER_PROOF_DEADLINE_S,
  type ReceiptBodyV1,
} from "@sdiqt/protocol";
import { type BundleVerdict, manifestVsBatch, qstrVsManifest, verifyBundle } from "@sdiqt/verify";
import { type BundleSource, bundleName } from "./bundles.ts";
import type { TowerChain } from "./chain-view.ts";
import { type Challenger, decideChallenge } from "./challenge.ts";
import type { ExitDesk } from "./exits.ts";
import { judgeBatch } from "./judge.ts";
import { receiptState, SOUNDNESS_NOTE, signReceipt } from "./receipt.ts";
import { type ChainRecord, type Settlement, settle, validity } from "./settle.ts";
import type { BatchRow, ChallengeRow, TowerStore } from "./store.ts";

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
  /** Sends challenges; without it a confirmed fraud is recorded as `watch` only. */
  challenger?: Challenger;
  /** Releases due exit packets each tick; see exits.ts. */
  exits?: ExitDesk;
}

/** A failed challenge send is retried on later ticks up to this many times. */
export const MAX_CHALLENGE_ATTEMPTS = 3;

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

  /**
   * Decide, send and follow one challenge. A send happens only while the batch
   * is pending inside its window, and only for a proof the local
   * `checkQledgerFraud` calls fraud.
   */
  private async challengeStep(c: {
    b: BatchRecord;
    k: string;
    suspect: boolean;
    planOf: () => BatchPlan;
    open: boolean;
    settlement: Settlement | "unknown";
    /** Re-execution matched the chain; only the bundle disagreed. */
    reexecMatch: boolean;
  }): Promise<void> {
    const { store, log, chainId, rollupId } = this.o;
    const at = this.nowDate().toISOString();
    const ch = store.challenge(c.k);
    if (ch?.status === "sent" && (c.settlement === "rejected" || c.settlement === "final")) {
      const status = c.settlement === "rejected" ? "upheld" : "dismissed";
      store.putChallenge({ ...ch, status, resolved_at: at });
      log({
        event: `challenge_${status}`,
        alert: status === "dismissed",
        batch_index: c.b.batch_index,
        txhash: c.b.txhash,
        challenge_tx: ch.txhash,
      });
      return;
    }
    if (!c.suspect || !c.open) return;
    // A recorded `watch` is sent once a challenger is configured; a failed send is retried.
    const retry =
      (ch?.status === "failed" && ch.attempts < MAX_CHALLENGE_ATTEMPTS) ||
      (ch?.status === "watch" && this.o.challenger !== undefined);
    if (ch && !retry) return;

    let plan: BatchPlan;
    let d: ReturnType<typeof decideChallenge>;
    try {
      plan = c.planOf();
      d = decideChallenge({ chainId, rollupId, batch: c.b, plan });
    } catch (err) {
      // Building the proof failed: record it and keep the tick going.
      store.putChallenge({
        key: c.k,
        rollup_id: rollupId,
        batch_index: c.b.batch_index,
        status: "refused",
        reason: `fraud proof could not be built: ${(err as Error).message}`,
        txhash: null,
        attempts: ch?.attempts ?? 0,
        honest_state_root: ch?.honest_state_root ?? c.b.state_root,
        at,
        resolved_at: null,
        resubmitted_tx: null,
      });
      log({
        event: "challenge_refused",
        alert: true,
        reason: String(err),
        batch_index: c.b.batch_index,
        txhash: c.b.txhash,
      });
      return;
    }
    const row: ChallengeRow = {
      key: c.k,
      rollup_id: rollupId,
      batch_index: c.b.batch_index,
      status: "refused",
      reason: d.reason ?? null,
      txhash: null,
      attempts: ch?.attempts ?? 0,
      honest_state_root: plan.roots.stateRoot,
      at,
      resolved_at: null,
      resubmitted_tx: null,
    };
    const base = { batch_index: c.b.batch_index, txhash: c.b.txhash, proof_bytes: d.proof.length };
    if (!d.fraud) {
      store.putChallenge(row);
      // Re-execution agrees with the chain but our verified bundle does not: our side is wrong.
      const ours = c.reexecMatch;
      log({
        event: ours ? "bundle_disagrees" : "challenge_refused",
        alert: true,
        reason: ours ? "re-execution matches the chain; the proof bundle differs" : d.reason,
        ...base,
      });
      return;
    }
    if (!this.o.challenger) {
      store.putChallenge({ ...row, status: "watch", reason: "no challenger configured" });
      log({ event: "would_challenge", alert: true, ...base });
      return;
    }
    try {
      const { txhash } = await this.o.challenger(c.b.batch_index, d.proof);
      store.putChallenge({
        ...row,
        status: "sent",
        reason: null,
        txhash,
        attempts: row.attempts + 1,
      });
      log({ event: "challenge_sent", alert: true, challenge_tx: txhash, ...base });
    } catch (err) {
      store.putChallenge({
        ...row,
        status: "failed",
        reason: String(err),
        attempts: row.attempts + 1,
      });
      log({ event: "challenge_failed", alert: true, error: String(err), ...base });
    }
  }

  /** Note the submission that retook a challenged batch's index. */
  private trackResubmission(b: BatchRecord, all: readonly BatchRecord[]): void {
    const ch = this.o.store.challenge(key(b));
    if (!ch || ch.resubmitted_tx) return;
    const next = all
      .filter((o) => o.batch_index === b.batch_index && BigInt(o.height) > BigInt(b.height))
      .sort((x, y) => Number(BigInt(x.height) - BigInt(y.height)))[0];
    if (!next) return;
    this.o.store.putChallenge({ ...ch, resubmitted_tx: next.txhash });
    this.o.log({
      event: "resubmitted",
      batch_index: b.batch_index,
      txhash: b.txhash,
      resubmitted_tx: next.txhash,
    });
  }

  async tick(): Promise<{ batches: number; receipts: number; exits: number }> {
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
    // Settlement of each submission seen so far this tick, for the rollback cascade.
    const settledAs = new Map<string, Settlement | "unknown">();

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
        settledAs.set(k, prev.settlement as Settlement);
        this.trackResubmission(b, batches);
        continue;
      }

      const fresh = prev ? undefined : judgeBatch(this.replay, chainId, rollupId, b);
      const judged = fresh ?? {
        match: prev?.judged === "match",
        differs: JSON.parse(prev?.differs ?? "[]") as string[],
      };
      const planOf = () => (fresh ?? judgeBatch(this.replay, chainId, rollupId, b)).plan;
      // A settled batch stays settled: no chain read needed.
      const settled = prev?.settlement === "final" || prev?.settlement === "rejected";
      const record: ChainRecord = settled
        ? { kind: "missing" }
        : await chain.batch(rollupId, b.batch_index);
      const anchor = anchors.find(
        (a) => String(a.layerHeight) === b.batch_index && a.stateRoot === b.state_root,
      );
      const cascaded = rolledBack(b, batches, settledAs);
      const s = settled
        ? { settlement: prev.settlement as Settlement, pruned: prev.pruned === 1 }
        : settle({
            stateRoot: b.state_root,
            withdrawalsRoot: b.withdrawals_root,
            dataHash: b.data_hash,
            height: BigInt(b.height),
            record,
            supersededLater: cascaded,
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
      let note: string | null = cascaded && !settled ? "rolled back by an upheld challenge" : null;
      let chainDiff: string[] = [];
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
          chainDiff = v.valid ? diff.filter((f) => f.startsWith("chain.")) : [];
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
      settledAs.set(k, s.settlement);
      await this.challengeStep({
        b,
        k,
        suspect: !judged.match || chainDiff.length > 0,
        planOf,
        open:
          s.settlement === "pending" &&
          record.kind === "found" &&
          record.status === "submitted" &&
          submittedTime !== null &&
          this.nowUnix() < submittedTime + windowSec,
        settlement: s.settlement,
        reexecMatch: judged.match,
      });
      this.trackResubmission(b, batches);
    }
    store.setPoll(rollupId, {
      at: this.nowDate().toISOString(),
      height: tip.toString(),
      window_s: String(windowSec),
    });
    let exits = 0;
    if (this.o.exits) {
      // Based order: a posted withdrawal runs after every entry already in the inbox.
      const ledger = this.replay.at(this.replay.head).ledger;
      exits = await this.o.exits.tick(tip, (id) => ledger.get(id).nonce);
    }
    return { batches: batches.length, receipts: issued, exits };
  }
}

const rootsOf = (b: BatchRecord) => ({
  prev_state_root: b.prev_state_root,
  state_root: b.state_root,
  withdrawals_root: b.withdrawals_root,
  data_hash: b.data_hash,
});

/**
 * Whether a later event rolled this submission back: the chain took a batch
 * index at or below ours after we were submitted, or a lower batch we were
 * built on was rejected before its index was retaken. The chain only reuses an
 * index after an upheld challenge, and that rolls back every pending batch
 * above it.
 */
export function rolledBack(
  b: BatchRecord,
  all: readonly BatchRecord[],
  settledAs: ReadonlyMap<string, string>,
): boolean {
  const idx = BigInt(b.batch_index);
  const h = BigInt(b.height);
  return all.some((o) => {
    if (o === b) return false;
    const oi = BigInt(o.batch_index);
    const oh = BigInt(o.height);
    if (oi > idx) return false;
    if (oh > h) return true;
    if (oi === idx || settledAs.get(key(o)) !== "rejected") return false;
    const retaken = all.some(
      (r) =>
        r !== o && BigInt(r.batch_index) === oi && BigInt(r.height) > oh && BigInt(r.height) <= h,
    );
    return !retaken;
  });
}

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
