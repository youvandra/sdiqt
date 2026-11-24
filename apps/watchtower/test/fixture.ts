/** A tower over the archived `rdk-v328-e2e` vector, with a fake chain and bundles. */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postedDataHash } from "@qorechain/rdk";
import type { BatchRecord, InboxRecord } from "@sdiqt/archiver";
import {
  type BundleManifestV1,
  encodeQstrV1,
  keygen,
  proofRoot,
  qstrFromManifest,
  toHex,
} from "@sdiqt/protocol";
import {
  bundleName,
  type Challenger,
  type LoadedBundle,
  Tower,
  type TowerChain,
  TowerStore,
} from "../src/index.ts";

const CHAIN = "qorechain-diana";
export const ROLLUP = "rdk-v328-e2e-mwd5v89d";
const OPERATOR = "qor1operator";
const VECTOR = new URL(`../../../vectors/archive/${ROLLUP}/`, import.meta.url).pathname;
const read = <T>(f: string): T[] =>
  readFileSync(join(VECTOR, f), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as T);
export const batches = read<BatchRecord>("batches.jsonl");
export const byTx = (p: string) => batches.find((b) => b.txhash.startsWith(p)) as BatchRecord;

/** A manifest for chain batch `b`, self-consistent so the QSTR derives from it. */
function manifestFor(b: BatchRecord): BundleManifestV1 {
  const proof_sha256 = "11".repeat(32);
  return {
    format: "sdiqt-proof-bundle",
    version: "1",
    chain_id: CHAIN,
    rollup_id: ROLLUP,
    batch_index: b.batch_index,
    inbox_from: b.inbox_start,
    inbox_end: b.inbox_end,
    parent_root: b.prev_state_root,
    state_root: b.state_root,
    withdrawals_root: b.withdrawals_root,
    data_hash: b.data_hash,
    sig_mode: "full",
    sp1_version: "6.10.0",
    program_vkey_hash: "22".repeat(32),
    proof_root: proofRoot([proof_sha256]),
    chunks: [{ index: "0", file: "chunk-0.bin", proof_sha256, public_values: "00" }],
  };
}

export function setup(
  opts: {
    qstrFor?: BatchRecord[];
    verifyValid?: boolean;
    tip?: bigint;
    now?: () => Date;
    /** Chain status per batch index; "missing" drops the record. Default finalized. */
    status?: (index: string) => string | undefined;
    challenger?: Challenger;
    /** Reuse an existing tower database (a restart). */
    db?: string;
  } = {},
) {
  const dir = mkdtempSync(join(tmpdir(), "sdiqt-tower-"));
  const archive = join(dir, ROLLUP);
  cpSync(VECTOR, archive, { recursive: true });
  // Our QSTR posts land after the last entry; they never touch earlier batches.
  const inbox = read<InboxRecord>("inbox.jsonl");
  let seq = inbox.length;
  for (const b of opts.qstrFor ?? []) {
    const bytes = encodeQstrV1(qstrFromManifest(manifestFor(b), "mac-1"));
    seq += 1;
    inbox.push({
      v: 1,
      kind: "post",
      sequence: String(seq),
      height: "10700000",
      txhash: seq.toString(16).padStart(64, "0").toUpperCase(),
      poster: OPERATOR,
      data_hash: toHex(postedDataHash(bytes)),
      payload: toHex(bytes),
    });
  }
  writeFileSync(join(archive, "inbox.jsonl"), inbox.map((r) => `${JSON.stringify(r)}\n`).join(""));

  // The chain as it stands: the latest submission at each index.
  let world = [...batches];
  const live = new Map<string, BatchRecord>();
  const setBatches = (list: BatchRecord[]) => {
    world = list;
    live.clear();
    for (const b of list) live.set(b.batch_index, b);
    writeFileSync(
      join(archive, "batches.jsonl"),
      list.map((b) => `${JSON.stringify(b)}\n`).join(""),
    );
  };
  setBatches(world);
  const chain: TowerChain = {
    async batch(_r, index) {
      const b = live.get(index);
      const status = opts.status?.(index) ?? "finalized";
      return b && status !== "missing"
        ? {
            kind: "found",
            status,
            stateRoot: b.state_root,
            withdrawalsRoot: b.withdrawals_root,
            dataHash: b.data_hash,
            submittedHeight: Number(b.height),
            submittedTime: 1_794_464_647,
          }
        : { kind: "missing" };
    },
    anchors: async () =>
      world.map((b) => ({
        layerHeight: Number(b.batch_index),
        stateRoot: b.state_root,
        anchoredAt: 1_794_464_647,
      })),
    tip: async () => opts.tip ?? 10_686_595n,
    retentionBlocks: async () => 432_000n,
    challengeWindowSec: async () => 3600,
  };
  const keys = keygen(new Uint8Array(32).fill(5));
  const dbFile = opts.db ?? join(dir, "tower.sqlite");
  const store = new TowerStore(dbFile);
  const events: Array<Record<string, unknown>> = [];
  const tower = new Tower({
    chainId: CHAIN,
    rollupId: ROLLUP,
    archiveDir: archive,
    chain,
    store,
    bundles: async (name): Promise<LoadedBundle | undefined> => {
      const b = batches.find((x) => bundleName(x.batch_index, x.txhash) === name);
      if (!b || !(opts.qstrFor ?? []).includes(b)) return undefined;
      const manifest = manifestFor(b);
      return { manifestJson: JSON.stringify(manifest), manifest, proofs: [new Uint8Array([1])] };
    },
    operator: OPERATOR,
    signer: { issuer: "qor1tower", secretKey: keys.secretKey },
    refreshArchive: async () => {},
    log: (e) => events.push(e),
    verify: () =>
      opts.verifyValid === false
        ? { valid: false, ms: 1, error: "chunk 0 proof rejected" }
        : { valid: true, ms: 1 },
    now: opts.now ?? (() => new Date(1_794_464_647_000 + 600_000)),
    ...(opts.challenger ? { challenger: opts.challenger } : {}),
  });
  return { tower, store, events, keys, setBatches, dbFile };
}
