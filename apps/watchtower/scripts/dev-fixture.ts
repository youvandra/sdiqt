#!/usr/bin/env node
/**
 * Dev fixture for the explorer: a watchtower over the archived `rdk-v328-e2e`
 * vector with a scripted chain, serving the read-only API. It shows every
 * state the explorer draws:
 *
 * - batch 1: a rolled-back fraud, then a resubmission proven by the REAL
 *   STARK bundle in `vectors/bundles/rdk-v328-e2e` (verified with the wasm
 *   verifier, about 100 ms), named by a QSTR post from the fixture operator;
 * - batch 4: a rolled-back fraud and its resubmission;
 * - batch 0: chain record pruned, settled from the anchor;
 * - batches 5 and 6: pending, inside their challenge window;
 * - batches 2 and 3: final, proof deadline passed without a proof.
 *
 * Only the chain is scripted; archive, judging, bundle checks and receipts are
 * the production code paths. Receipts are signed with a dev key (issuer `dev:`).
 *
 *   node apps/watchtower/scripts/dev-fixture.ts [--listen 127.0.0.1:8802]
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { sha256 } from "@noble/hashes/sha2.js";
import { postedDataHash } from "@qorechain/rdk";
import type { BatchRecord, InboxRecord } from "@sdiqt/archiver";
import { BundleManifestV1, encodeQstrV1, keygen, qstrFromManifest, toHex } from "@sdiqt/protocol";
import { bundleSource, createApiServer, Tower, type TowerChain, TowerStore } from "../src/index.ts";

const { values } = parseArgs({
  options: {
    listen: { type: "string", default: "127.0.0.1:8802" },
    interval: { type: "string", default: "30" },
  },
});

const CHAIN = "qorechain-diana";
const ROLLUP = "rdk-v328-e2e-mwd5v89d";
const OPERATOR = "qor1devfixtureoperator";
const ROOT = new URL("../../../", import.meta.url).pathname;
const VECTOR = join(ROOT, "vectors/archive", ROLLUP);
const BUNDLES = join(ROOT, "vectors/bundles/rdk-v328-e2e");
const PROVEN = "batch-1-FACE91C06DA7";

const lines = <T>(f: string): T[] =>
  readFileSync(f, "utf8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l) as T);

// Archive copy with our QSTR post appended after the last inbox entry.
const dir = mkdtempSync(join(tmpdir(), "sdiqt-dev-fixture-"));
const archiveDir = join(dir, ROLLUP);
cpSync(VECTOR, archiveDir, { recursive: true });
const batches = lines<BatchRecord>(join(VECTOR, "batches.jsonl"));
const inbox = lines<InboxRecord>(join(VECTOR, "inbox.jsonl"));
const manifest = BundleManifestV1.parse(
  JSON.parse(readFileSync(join(BUNDLES, PROVEN, "manifest.json"), "utf8")),
);
const qstr = encodeQstrV1(qstrFromManifest(manifest, "mac-1"));
const seq = inbox.length + 1;
inbox.push({
  v: 1,
  kind: "post",
  sequence: String(seq),
  height: "10700000",
  txhash: seq.toString(16).padStart(64, "0").toUpperCase(),
  poster: OPERATOR,
  data_hash: toHex(postedDataHash(qstr)),
  payload: toHex(qstr),
});
writeFileSync(join(archiveDir, "inbox.jsonl"), inbox.map((r) => `${JSON.stringify(r)}\n`).join(""));

// Scripted chain: latest submission per index, with the states listed above.
const latest = new Map<string, BatchRecord>();
for (const b of batches) latest.set(b.batch_index, b);
const started = Math.floor(Date.now() / 1000);
const PENDING_AGE_S: Record<string, number> = { "5": 2400, "6": 900 };
const OLD_TIME = started - 9 * 86_400;
const chain: TowerChain = {
  async batch(_rollup, index) {
    const b = latest.get(index);
    if (!b || index === "0") return { kind: "missing" };
    const age = PENDING_AGE_S[index];
    return {
      kind: "found",
      status: age === undefined ? "finalized" : "submitted",
      stateRoot: b.state_root,
      withdrawalsRoot: b.withdrawals_root,
      dataHash: b.data_hash,
      submittedHeight: Number(b.height),
      submittedTime: age === undefined ? OLD_TIME + Number(index) * 3600 : started - age,
    };
  },
  anchors: async () =>
    [...latest.values()].map((b) => ({
      layerHeight: Number(b.batch_index),
      stateRoot: b.state_root,
      anchoredAt: OLD_TIME,
    })),
  tip: async () => 10_700_000n,
  retentionBlocks: async () => 432_000n,
  challengeWindowSec: async () => 3600,
};

const keys = keygen(new Uint8Array(32).fill(7));
const store = new TowerStore(join(dir, "tower.sqlite"));
const tower = new Tower({
  chainId: CHAIN,
  rollupId: ROLLUP,
  archiveDir,
  chain,
  store,
  bundles: bundleSource(BUNDLES),
  operator: OPERATOR,
  signer: {
    issuer: `dev:${toHex(sha256(keys.publicKey)).slice(0, 16)}`,
    secretKey: keys.secretKey,
  },
  refreshArchive: async () => {},
  log: (e) => console.log(JSON.stringify({ at: new Date().toISOString(), ...e })),
});

await tower.tick();
const [host, port] = (values.listen ?? "").split(":");
const api = createApiServer({ store, rollupId: ROLLUP });
api.listen(Number(port), host, () =>
  console.log(JSON.stringify({ event: "listen", url: `http://${values.listen}`, db: dir })),
);
const timer = setInterval(() => void tower.tick(), Number(values.interval) * 1000);
process.on("SIGINT", () => {
  clearInterval(timer);
  api.close();
  process.exit(0);
});
