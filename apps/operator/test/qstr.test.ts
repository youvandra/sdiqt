import { readFileSync } from "node:fs";
import {
  bytesToHex,
  encodeQledgerDeposit,
  executeQledger,
  QledgerLedger,
  type RdkTxClient,
} from "@qorechain/rdk";
import type { InboxRecord } from "@sdiqt/archiver";
import { SafeTx, SpendCap } from "@sdiqt/chain";
import { BundleManifestV1, toHex } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import {
  archivedQstrs,
  postedDataFeeUqor,
  postQstr,
  prepareQstr,
  qstrForBatch,
} from "../src/qstr.ts";

const manifest = BundleManifestV1.parse(
  JSON.parse(
    readFileSync(
      new URL("../../../vectors/bundles/golden-v328/manifest.json", import.meta.url),
      "utf8",
    ),
  ),
);
const ROLLUP = manifest.rollup_id;
const OPERATOR = "qor1operator";

const post = (sequence: string, poster: string, payload: string): InboxRecord => ({
  v: 1,
  kind: "post",
  sequence,
  height: "1",
  txhash: `T${sequence}`,
  poster,
  data_hash: "00".repeat(32),
  payload,
});

describe("QSTR posting", () => {
  it("bills at least 1 KiB of posted data", () => {
    expect(postedDataFeeUqor(306, 10n)).toBe(10_240n);
    expect(postedDataFeeUqor(2000, 10n)).toBe(20_000n);
  });

  it("simulates, reserves gas plus data fee, posts and reads the sequence back", async () => {
    const { bytes, dataHash } = prepareQstr(manifest, "p1");
    const sent: Uint8Array[] = [];
    const tx = {
      address: OPERATOR,
      postRollupData: async (input: { rollupId: string; data: Uint8Array }) => {
        sent.push(input.data);
        return {
          code: 0,
          height: 77,
          transactionHash: "ABC",
          events: [
            {
              type: "rdk_data_posted",
              attributes: [
                { key: "rollup_id", value: ROLLUP },
                { key: "sequence", value: "42" },
                { key: "data_hash", value: dataHash.toUpperCase() },
              ],
            },
          ],
        };
      },
    } as unknown as RdkTxClient;
    const cap = new SpendCap(1_000_000n);
    const safe = new SafeTx(
      { simulate: async () => 100_000 },
      { gasPriceNumerator: 15n, gasPriceScale: 100n, cap },
    );
    const r = await postQstr({ tx, safe, rollupId: ROLLUP, feePerByte: 10n }, manifest, "p1");
    expect(r).toMatchObject({
      txhash: "ABC",
      height: 77,
      sequence: "42",
      dataHash,
      bytes: bytes.length,
    });
    expect(toHex(sent[0] as Uint8Array)).toBe(toHex(bytes));
    // gas 100k * 1.3 * 0.15 = 19,500 uqor, plus 10,240 data fee
    expect(cap.snapshot().spentUqor).toBe(29_740n);
  });

  it("refuses a manifest of another rollup", async () => {
    const safe = new SafeTx(
      { simulate: async () => 1 },
      { gasPriceNumerator: 1n, gasPriceScale: 1n, cap: new SpendCap(1n) },
    );
    const o = {
      tx: { address: OPERATOR } as RdkTxClient,
      safe,
      rollupId: "other",
      feePerByte: 10n,
    };
    await expect(postQstr(o, manifest, "p")).rejects.toThrow(/manifest is for/);
  });
});

describe("archived QSTRs", () => {
  const good = toHex(prepareQstr(manifest, "p1").bytes);
  const entries = [
    post("1", OPERATOR, "00aa"),
    post("2", "qor1stranger", good),
    post("3", OPERATOR, "51535452ff"),
    post("4", OPERATOR, good),
    post("5", OPERATOR, good),
  ];

  it("keeps only well-formed commitments from our poster", () => {
    expect(archivedQstrs(entries, OPERATOR).map((q) => q.sequence)).toEqual(["4", "5"]);
  });

  it("finds the first QSTR for a batch", () => {
    expect(qstrForBatch(entries, OPERATOR, manifest.batch_index)?.sequence).toBe("4");
    expect(qstrForBatch(entries, OPERATOR, "999")).toBeUndefined();
  });
});

describe("QSTR in the inbox", () => {
  it("is a no-op entry when qledger-v1 executes it", () => {
    const env = { chainId: "qorechain-diana", rollupId: ROLLUP };
    const deposit = {
      height: 1,
      poster: "deposit:qor1alice",
      payload: encodeQledgerDeposit(new Uint8Array(32).fill(7), 5_000_000n),
    };
    const qstr = { height: 2, poster: OPERATOR, payload: prepareQstr(manifest, "p1").bytes };
    const plain = executeQledger(env, new QledgerLedger(), [deposit]);
    const withQstr = executeQledger(env, new QledgerLedger(), [deposit, qstr]);
    expect(bytesToHex(withQstr.stateRoot)).toBe(bytesToHex(plain.stateRoot));
    expect(withQstr.withdrawals).toEqual([]);
  });
});
