import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { postedDataHash } from "@qorechain/rdk";
import type { BatchRecord, InboxRecord } from "@sdiqt/archiver";
import {
  type BundleManifestV1,
  encodeQstrV1,
  fromHex,
  keygen,
  proofRoot,
  qstrFromManifest,
  SIGNING_CONTEXTS,
  toHex,
  verifyDocument,
} from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import { bundleName, type LoadedBundle, Tower, type TowerChain, TowerStore } from "../src/index.ts";

const CHAIN = "qorechain-diana";
const ROLLUP = "rdk-v328-e2e-mwd5v89d";
const OPERATOR = "qor1operator";
const VECTOR = new URL(`../../../vectors/archive/${ROLLUP}/`, import.meta.url).pathname;
const read = <T>(f: string): T[] =>
  readFileSync(join(VECTOR, f), "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as T);
const batches = read<BatchRecord>("batches.jsonl");
const byTx = (p: string) => batches.find((b) => b.txhash.startsWith(p)) as BatchRecord;

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

function setup(opts: { qstrFor?: BatchRecord[]; verifyValid?: boolean; tip?: bigint } = {}) {
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

  // The chain as it stands: the live submission at each index, finalized.
  const live = new Map<string, BatchRecord>();
  for (const b of batches) live.set(b.batch_index, b);
  const chain: TowerChain = {
    async batch(_r, index) {
      const b = live.get(index);
      return b
        ? {
            kind: "found",
            status: "finalized",
            stateRoot: b.state_root,
            withdrawalsRoot: b.withdrawals_root,
            dataHash: b.data_hash,
            submittedHeight: Number(b.height),
            submittedTime: 1_794_464_647,
          }
        : { kind: "missing" };
    },
    anchors: async () =>
      batches.map((b) => ({
        layerHeight: Number(b.batch_index),
        stateRoot: b.state_root,
        anchoredAt: 1_794_464_647,
      })),
    tip: async () => opts.tip ?? 10_686_595n,
    retentionBlocks: async () => 432_000n,
    challengeWindowSec: async () => 3600,
  };
  const keys = keygen(new Uint8Array(32).fill(5));
  const store = new TowerStore(join(dir, "tower.sqlite"));
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
    now: () => new Date(1_794_464_647_000 + 600_000),
  });
  return { tower, store, events, keys };
}

describe("watchtower", () => {
  it("judges every archived batch like the chain did: the two rolled-back frauds mismatch", async () => {
    const { tower, store } = setup();
    await tower.tick();
    const rows = store.list(ROLLUP);
    expect(rows).toHaveLength(9);
    const bad = rows
      .filter((r) => r.judged === "mismatch")
      .map((r) => r.txhash.slice(0, 8))
      .sort();
    expect(bad).toEqual(["3BC15BD0", "B30CD12C"]);
    expect(rows.find((r) => r.txhash.startsWith("3BC15BD0"))?.settlement).toBe("rejected");
    expect(rows.find((r) => r.txhash.startsWith("2EAA9C1D"))?.settlement).toBe("final");
  });

  it("issues PROVEN receipts for batches with a verified bundle and our QSTR, signed by the tower", async () => {
    const b0 = byTx("929C7A21");
    const { tower, store, keys } = setup({ qstrFor: [b0] });
    await tower.tick();
    const key = `${b0.txhash}:0`;
    const latest = store.latestReceipt(key);
    expect(latest?.receipt.body).toMatchObject({
      settlement: "final",
      validity: "proven",
      batch_index: "0",
    });
    expect(latest?.receipt.body.proof).toMatchObject({ prover_id: "mac-1", chunk_count: "1" });
    const r = latest?.receipt;
    if (!r) throw new Error("no receipt");
    expect(
      verifyDocument(r.body, fromHex(r.signature), keys.publicKey, SIGNING_CONTEXTS.receiptV1),
    ).toBe(true);
    // Others without a QSTR are still proving inside the deadline.
    expect(store.get(`${byTx("FACE91C0").txhash}:0`)?.validity).toBe("proving");
  });

  it("does not call a batch proven when its bundle fails verification", async () => {
    const b0 = byTx("929C7A21");
    const { tower, store, events } = setup({ qstrFor: [b0], verifyValid: false });
    await tower.tick();
    expect(store.get(`${b0.txhash}:0`)).toMatchObject({ validity: "proving" });
    expect(store.get(`${b0.txhash}:0`)?.note).toMatch(/INVALID/);
    expect(events.some((e) => e.event === "bundle_checked" && e.valid === false)).toBe(true);
  });

  it("issues a new receipt only when settlement or validity changes", async () => {
    const { tower, store } = setup({ qstrFor: [byTx("929C7A21")] });
    const first = await tower.tick();
    const second = await tower.tick();
    expect(first.receipts).toBeGreaterThan(0);
    expect(second.receipts).toBe(0);
    expect(store.receipts(`${byTx("929C7A21").txhash}:0`)).toHaveLength(1);
  });
});
