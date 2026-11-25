/**
 * Case 4: a QSTR commitment replayed for another batch. The watchtower takes
 * a QSTR as the proof of a batch only when `qstrVsManifest` and
 * `manifestVsBatch` from `@sdiqt/verify` both return no differing fields
 * (`apps/watchtower/src/tower.ts`, the proof step of `tick`).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeQstrV1,
  encodeQstrV1,
  fromHex,
  type QstrV1,
  qstrFromManifest,
} from "@sdiqt/protocol";
import { type ChainBatch, manifestVsBatch, qstrVsManifest } from "@sdiqt/verify";
import { ACCEPTED, type Case, loadBundle, ROOT } from "./common.ts";

const rdk = loadBundle("vectors/bundles/rdk-v328-e2e/batch-1-FACE91C06DA7");
const batches = readFileSync(
  join(ROOT, "vectors/archive/rdk-v328-e2e-mwd5v89d/batches.jsonl"),
  "utf8",
)
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l) as ChainBatch & { txhash: string });
const chainBatch = (tx: string) => {
  const b = batches.find((x) => x.txhash.startsWith(tx));
  if (!b) throw new Error(`no chain batch ${tx} in the archive vector`);
  return b;
};
/** The chain batch the rdk bundle proves, and an earlier submission at the same index. */
const proven = chainBatch("FACE91C06DA7");
const superseded = chainBatch("B30CD12C7F19");

/** The tower's acceptance rule: no field of the QSTR, bundle or chain batch may differ. */
function towerMatch(q: QstrV1, batch: ChainBatch): string {
  const diff = [
    ...qstrVsManifest(q, rdk.manifest).map((f) => `qstr.${f}`),
    ...manifestVsBatch(rdk.manifest, batch).map((f) => `chain.${f}`),
  ];
  return diff.length ? `differs: ${diff.join(", ")}` : ACCEPTED;
}

/** Bytes as the operator posts them, decoded as the tower reads them from the inbox. */
const roundTrip = (q: QstrV1) => decodeQstrV1(encodeQstrV1(q));

export function replayedQstr(): Case {
  const own = roundTrip(qstrFromManifest(rdk.manifest, "sdiqt-redteam"));
  const golden = decodeQstrV1(
    fromHex(readFileSync(join(ROOT, "vectors/qstr/golden-v328.hex"), "utf8").trim()),
  );
  // The golden commitment with every batch field rewritten to rdk batch 1;
  // its proof fields still name the golden bundle.
  const relabelled = roundTrip({
    ...golden,
    chainId: own.chainId,
    rollupId: own.rollupId,
    batchIndex: own.batchIndex,
    inboxFrom: own.inboxFrom,
    inboxEnd: own.inboxEnd,
    prevStateRoot: own.prevStateRoot,
    stateRoot: own.stateRoot,
    withdrawalsRoot: own.withdrawalsRoot,
    dataHash: own.dataHash,
  });
  return {
    id: "4",
    title: "Replayed QSTR for another batch",
    code: [
      "packages/verify/src/match.ts: qstrVsManifest, manifestVsBatch",
      "packages/protocol/src/qstr.ts: decodeQstrV1",
    ],
    control: {
      input: `QSTR of rdk batch 1 (${proven.txhash.slice(0, 12)}) with its own bundle and chain batch`,
      got: towerMatch(own, proven),
    },
    attempts: [
      {
        attack: "golden QSTR (vectors/qstr/golden-v328.hex, batch 0) replayed as rdk batch 1's",
        expect: /^differs: .*qstr\.batch_index.*qstr\.manifest_sha256/,
        got: towerMatch(golden, proven),
      },
      {
        attack: "golden QSTR relabelled with rdk batch 1's chain, rollup, inbox and roots",
        expect: /^differs: .*qstr\.proof_root, qstr\.manifest_sha256$/,
        got: towerMatch(relabelled, proven),
      },
      {
        attack: `rdk batch 1 QSTR and bundle replayed for the other batch 1 submission ${superseded.txhash.slice(0, 12)}`,
        expect: /^differs: chain\.state_root/,
        got: towerMatch(own, superseded),
      },
    ],
  };
}
