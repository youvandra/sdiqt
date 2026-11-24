import { bytesToBase64, bytesToHex, encodeQledgerDeposit, postedDataHash } from "@qorechain/rdk";
import { describe, expect, it } from "vitest";
import {
  ArchiveError,
  batchRecords,
  depositRecords,
  fromJsonl,
  type InboxRecord,
  inboxGaps,
  mergeBatches,
  mergeInbox,
  postRecords,
  replayAccumulator,
  type TxResponse,
  toJsonl,
} from "../src/index.ts";

const ROLLUP = "test-rollup";
const POSTER = "qor1poster";
const payload = new Uint8Array([1, 2, 3, 4]);
const dataHash = bytesToHex(postedDataHash(payload));
const ev = (type: string, a: Record<string, string>) => ({
  type,
  attributes: Object.entries(a).map(([key, value]) => ({ key, value })),
});

const postTx: TxResponse = {
  height: "100",
  txhash: "AA",
  code: 0,
  tx: {
    body: {
      messages: [
        {
          "@type": "/qorechain.rdk.v1.MsgPostRollupData",
          poster: POSTER,
          data: bytesToBase64(payload),
        },
      ],
    },
  },
  events: [
    ev("rdk_data_posted", {
      rollup_id: ROLLUP,
      sequence: "2",
      poster: POSTER,
      data_hash: dataHash,
      msg_index: "0",
    }),
    ev("rdk_data_posted", {
      rollup_id: "other",
      sequence: "9",
      poster: POSTER,
      data_hash: dataHash,
    }),
  ],
};

const account = "11".repeat(32);
const depositTx: TxResponse = {
  height: "90",
  txhash: "BB",
  events: [
    ev("rdk_rollup_deposit", {
      rollup_id: ROLLUP,
      sequence: "1",
      depositor: "qor1alice",
      account,
      amount: "5000uqor",
    }),
  ],
};

const root = (n: number) => bytesToBase64(new Uint8Array(32).fill(n));
const batchTx: TxResponse = {
  height: "120",
  txhash: "CC",
  tx: {
    body: {
      messages: [
        {
          "@type": "/qorechain.rdk.v1.MsgSubmitBatch",
          sequencer: "qor1seq",
          rollup_id: ROLLUP,
          batch_index: "0",
          tx_count: "2",
          prev_state_root: root(1),
          state_root: root(2),
          withdrawals_root: root(3),
          data_hash: root(4),
        },
      ],
    },
  },
  events: [
    ev("rdk_inbox_consumed", {
      rollup_id: ROLLUP,
      batch_index: "0",
      inbox_start: "0",
      inbox_end: "2",
    }),
  ],
};

describe("records from tx responses", () => {
  it("reads posts of this rollup only, with the matching payload", () => {
    const [p, ...rest] = postRecords(ROLLUP, [postTx]);
    expect(rest).toHaveLength(0);
    expect(p).toMatchObject({
      kind: "post",
      sequence: "2",
      height: "100",
      poster: POSTER,
      data_hash: dataHash,
    });
    expect(p?.payload).toBe("01020304");
  });

  it("refuses a post whose payload does not hash to the event's data_hash", () => {
    const bad = structuredClone(postTx);
    const msg = bad.tx?.body?.messages?.[0];
    if (msg) msg.data = bytesToBase64(new Uint8Array([9]));
    expect(() => postRecords(ROLLUP, [bad])).toThrow(ArchiveError);
  });

  it("skips failed transactions", () => {
    expect(postRecords(ROLLUP, [{ ...postTx, code: 5 }])).toEqual([]);
  });

  it("encodes deposits the way qledger replays them", () => {
    const [d] = depositRecords(ROLLUP, [depositTx]);
    const encoded = encodeQledgerDeposit(account, 5000n);
    expect(d).toMatchObject({ kind: "deposit", sequence: "1", poster: "deposit:qor1alice" });
    expect(d?.payload).toBe(bytesToHex(encoded));
    expect(d?.data_hash).toBe(bytesToHex(postedDataHash(encoded)));
  });

  it("reads batch roots as hex from the message", () => {
    const [b] = batchRecords(ROLLUP, [batchTx]);
    expect(b).toMatchObject({
      batch_index: "0",
      inbox_start: "0",
      inbox_end: "2",
      msg_index: "0",
      tx_count: "2",
    });
    expect(b?.state_root).toBe("02".repeat(32));
  });

  it("refuses a batch event whose index differs from its message", () => {
    const bad = structuredClone(batchTx);
    const e = bad.events?.[0];
    if (e?.attributes?.[1]) e.attributes[1].value = "7";
    expect(() => batchRecords(ROLLUP, [bad])).toThrow(ArchiveError);
  });
});

describe("merge", () => {
  const entries = [...postRecords(ROLLUP, [postTx]), ...depositRecords(ROLLUP, [depositTx])];

  it("orders by sequence and is idempotent", () => {
    const once = mergeInbox(entries);
    expect(once.map((e) => e.sequence)).toEqual(["1", "2"]);
    expect(toJsonl(mergeInbox(once, entries))).toBe(toJsonl(once));
    expect(fromJsonl<InboxRecord>(toJsonl(once))).toEqual(once);
  });

  it("throws when one sequence is read with two contents", () => {
    const [first] = entries;
    if (!first) throw new Error("fixture");
    expect(() => mergeInbox(entries, [{ ...first, height: "1" }])).toThrow(ArchiveError);
  });

  it("keeps two batches with the same index from different transactions", () => {
    const [b] = batchRecords(ROLLUP, [batchTx]);
    if (!b) throw new Error("fixture");
    const merged = mergeBatches([{ ...b, txhash: "DD", height: "130" }], [b], [b]);
    expect(merged.map((x) => x.txhash)).toEqual(["CC", "DD"]);
  });

  it("reports gaps and refuses to replay across one", () => {
    const [, post] = mergeInbox(entries);
    if (!post) throw new Error("fixture");
    expect(inboxGaps([post])).toEqual(["1"]);
    expect(() => replayAccumulator("c", ROLLUP, [post])).toThrow(ArchiveError);
    expect(replayAccumulator("c", ROLLUP, mergeInbox(entries))).toMatch(/^[0-9a-f]{64}$/);
  });
});
