import { fileURLToPath } from "node:url";
import { checkQledgerFraud, MockTxClient, RdkTxClient } from "@qorechain/rdk";
import { type BatchRecord, readArchive } from "@sdiqt/archiver";
import { parseGasPrice, SafeTx, SpendCap } from "@sdiqt/chain";
import { InboxReplay } from "@sdiqt/operator";
import { ApiBatchDetailV1, CHAIN_GAS_PRICE } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import {
  batchDetail,
  type Challenger,
  decideChallenge,
  judgeBatch,
  liveChallenger,
  rolledBack,
} from "../src/index.ts";
import { batches, byTx, ROLLUP, setup } from "./fixture.ts";

const CHAIN = "qorechain-diana";
const VECTOR = fileURLToPath(new URL(`../../../vectors/archive/${ROLLUP}/`, import.meta.url));
const BOND = 1_000_000_000n;

/** Flip the last byte of a hex root. */
const flip = (h: string) =>
  h.slice(0, -2) + (Number.parseInt(h.slice(-2), 16) ^ 1).toString(16).padStart(2, "0");

/** The vector with batch 5 (C3B4F90C) carrying a forged state root. */
const forged = (): BatchRecord[] =>
  batches.map((b) =>
    b.txhash.startsWith("C3B4F90C") ? { ...b, state_root: flip(b.state_root) } : b,
  );

async function planFor(b: BatchRecord) {
  const { entries } = await readArchive(VECTOR);
  const replay = new InboxReplay(CHAIN, ROLLUP);
  replay.setEntries(entries);
  return judgeBatch(replay, CHAIN, ROLLUP, b);
}

/** A challenger over RDK's mock tx client: simulates, signs and "broadcasts" with code 0. */
function mockChallenger() {
  const mock = new MockTxClient({ response: { transactionHash: "CC".repeat(32) } });
  const tx = RdkTxClient.fromClient(mock, "qor1tower", { gasPrice: CHAIN_GAS_PRICE });
  const cap = new SpendCap(1_050_000_000n);
  const safe = new SafeTx(tx, { ...parseGasPrice(CHAIN_GAS_PRICE), cap });
  return { mock, cap, challenger: liveChallenger(tx, safe, ROLLUP, BOND) };
}

describe("challenge decision", () => {
  it("calls a forged state root fraud, and the proof is what the chain would accept", async () => {
    const b = forged().find((x) => x.txhash.startsWith("C3B4F90C")) as BatchRecord;
    const j = await planFor(b);
    expect(j.match).toBe(false);
    const d = decideChallenge({ chainId: CHAIN, rollupId: ROLLUP, batch: b, plan: j.plan });
    expect(d.fraud).toBe(true);
    expect(d.proof.length).toBeGreaterThan(0);
    expect(j.plan.roots.stateRoot).toBe(byTx("C3B4F90C").state_root);
  });

  it("refuses to challenge an honest batch", async () => {
    const b = byTx("C3B4F90C");
    const d = decideChallenge({
      chainId: CHAIN,
      rollupId: ROLLUP,
      batch: b,
      plan: (await planFor(b)).plan,
    });
    expect(d).toMatchObject({ fraud: false, reason: expect.stringMatching(/honest/) });
  });

  it("refuses when the local check cannot decide the proof", async () => {
    const honest = byTx("C3B4F90C");
    // A proof built for batch 5's inputs, claimed against batch 6's range.
    const b6 = { ...byTx("4D19704D"), state_root: flip(byTx("4D19704D").state_root) };
    const d = decideChallenge({
      chainId: CHAIN,
      rollupId: ROLLUP,
      batch: b6,
      plan: (await planFor(honest)).plan,
    });
    expect(d.fraud).toBe(false);
    expect(d.reason).toMatch(/cannot decide|honest/);
  });
});

describe("live challenger", () => {
  it("simulates MsgChallengeBatch, reserves fee plus bond, and broadcasts with code 0", async () => {
    const b = forged().find((x) => x.txhash.startsWith("C3B4F90C")) as BatchRecord;
    const d = decideChallenge({
      chainId: CHAIN,
      rollupId: ROLLUP,
      batch: b,
      plan: (await planFor(b)).plan,
    });
    const { mock, cap, challenger } = mockChallenger();
    const { txhash } = await challenger(b.batch_index, d.proof);
    expect(txhash).toBe("CC".repeat(32));
    expect(mock.calls).toHaveLength(1);
    const msg = mock.calls[0]?.messages[0];
    expect(msg?.typeUrl).toMatch(/MsgChallengeBatch$/);
    expect(msg?.value).toMatchObject({ challenger: "qor1tower", rollupId: ROLLUP });
    // The bond counts against the cap: a second challenge would exceed 1,050 QOR.
    expect(cap.snapshot().spentUqor).toBeGreaterThan(BOND);
    await expect(challenger(b.batch_index, d.proof)).rejects.toThrow(/cap/);
    expect(
      checkQledgerFraud(
        { chainId: CHAIN, rollupId: ROLLUP },
        {
          inboxStart: BigInt(b.inbox_start),
          inboxEnd: BigInt(b.inbox_end),
          dataHash: b.data_hash,
          prevStateRoot: b.prev_state_root,
          stateRoot: b.state_root,
          withdrawalsRoot: b.withdrawals_root,
        },
        d.proof,
      ),
    ).toBe(true);
  });
});

describe("watchtower challenge path", () => {
  /** Batches 5 (forged) and 6 pending on chain inside their window; the rest final. */
  function world(opts: { challenger?: Challenger } = {}) {
    const status = new Map<string, string>([
      ["5", "submitted"],
      ["6", "submitted"],
    ]);
    const t = setup({ status: (i) => status.get(i), ...opts });
    t.setBatches(forged());
    return { ...t, status };
  }

  it("challenges the forged batch, then marks it VOID and rolls back the batch above it", async () => {
    const sent: Array<{ index: string; bytes: number }> = [];
    const challenger: Challenger = async (index, proof) => {
      sent.push({ index, bytes: proof.length });
      return { txhash: "AB".repeat(32) };
    };
    const { tower, store, status, events, setBatches } = world({ challenger });
    await tower.tick();

    const bad = forged().find((x) => x.txhash.startsWith("C3B4F90C")) as BatchRecord;
    const k5 = `${bad.txhash}:0`;
    const k6 = `${byTx("4D19704D").txhash}:0`;
    expect(sent).toEqual([{ index: "5", bytes: expect.any(Number) }]);
    expect(store.challenge(k5)).toMatchObject({
      status: "sent",
      txhash: "AB".repeat(32),
      attempts: 1,
    });
    expect(store.challenge(k5)?.honest_state_root).toBe(byTx("C3B4F90C").state_root);
    expect(store.get(k5)).toMatchObject({
      judged: "mismatch",
      settlement: "pending",
      validity: "mismatch",
    });
    expect(store.get(k6)).toMatchObject({ judged: "match", settlement: "pending" });
    // Nothing else is challenged: the historical frauds are already final or rejected.
    expect(store.challenge(`${byTx("B30CD12C").txhash}:0`)).toBeUndefined();

    // A second tick while still pending sends nothing new.
    await tower.tick();
    expect(sent).toHaveLength(1);

    // The chain upholds the challenge: 5 rejected, 6 (pending above it) removed.
    status.set("5", "rejected");
    status.set("6", "missing");
    await tower.tick();
    expect(store.get(k5)).toMatchObject({ settlement: "rejected", validity: "mismatch" });
    expect(store.challenge(k5)).toMatchObject({ status: "upheld" });
    expect(store.get(k6)).toMatchObject({
      settlement: "rejected",
      note: "rolled back by an upheld challenge",
    });
    const void5 = store.latestReceipt(k5)?.receipt.body;
    expect(void5).toMatchObject({ settlement: "rejected", validity: "mismatch" });
    expect(store.latestReceipt(k6)?.receipt.body.settlement).toBe("rejected");

    // The honest operator resubmits 5 and 6; the tower links the resubmission.
    const re5 = { ...byTx("C3B4F90C"), txhash: "E5".repeat(32), height: "10500000" };
    const re6 = { ...byTx("4D19704D"), txhash: "E6".repeat(32), height: "10500010" };
    setBatches([...forged(), re5, re6]);
    status.set("5", "finalized");
    status.set("6", "finalized");
    await tower.tick();
    expect(store.challenge(k5)?.resubmitted_tx).toBe(re5.txhash);
    expect(store.get(`${re5.txhash}:0`)).toMatchObject({ judged: "match", settlement: "final" });
    expect(store.get(`${re6.txhash}:0`)).toMatchObject({ judged: "match", settlement: "final" });
    // The explorer sees the whole story at index 5 through the shared schema.
    const d = ApiBatchDetailV1.parse(batchDetail({ store, rollupId: ROLLUP }, "5"));
    expect(d.submissions.map((x) => [x.settlement, x.challenge?.status ?? null])).toEqual([
      ["rejected", "upheld"],
      ["final", null],
    ]);
    expect(d.submissions[0]?.challenge?.resubmitted_tx).toBe(re5.txhash);
    expect(events.map((e) => e.event)).toEqual(
      expect.arrayContaining(["challenge_sent", "challenge_upheld", "resubmitted"]),
    );
  });

  it("records a confirmed fraud as watch when no challenger is configured", async () => {
    const { tower, store, events } = world();
    await tower.tick();
    const bad = forged().find((x) => x.txhash.startsWith("C3B4F90C")) as BatchRecord;
    expect(store.challenge(`${bad.txhash}:0`)).toMatchObject({ status: "watch", txhash: null });
    expect(events.some((e) => e.event === "would_challenge")).toBe(true);
  });

  it("retries a failed send at most three times", async () => {
    let calls = 0;
    const challenger: Challenger = async () => {
      calls += 1;
      throw new Error("simulation failed: out of gas");
    };
    const { tower, store } = world({ challenger });
    for (let i = 0; i < 5; i++) await tower.tick();
    const bad = forged().find((x) => x.txhash.startsWith("C3B4F90C")) as BatchRecord;
    expect(calls).toBe(3);
    expect(store.challenge(`${bad.txhash}:0`)).toMatchObject({ status: "failed", attempts: 3 });
  });

  it("does not challenge once the challenge window has closed", async () => {
    const calls: string[] = [];
    const t = setup({
      status: (i) => (i === "5" || i === "6" ? "submitted" : undefined),
      challenger: async (i) => {
        calls.push(i);
        return { txhash: "AB".repeat(32) };
      },
      // Submitted at 1_794_464_647; the window is 3,600 s.
      now: () => new Date((1_794_464_647 + 3_601) * 1000),
    });
    t.setBatches(forged());
    await t.tower.tick();
    expect(calls).toEqual([]);
  });
});

describe("rollback cascade", () => {
  const b = (index: string, height: string, tx: string): BatchRecord => ({
    ...byTx("C3B4F90C"),
    batch_index: index,
    height,
    txhash: tx.repeat(64 / tx.length),
  });
  const key = (x: BatchRecord) => `${x.txhash}:${x.msg_index}`;

  it("rolls back a batch when an index at or below it is retaken later", () => {
    const a5 = b("5", "100", "A5");
    const a6 = b("6", "110", "A6");
    const r5 = b("5", "120", "B5");
    expect(rolledBack(a6, [a5, a6, r5], new Map())).toBe(true);
    expect(rolledBack(a5, [a5, a6, r5], new Map())).toBe(true);
    expect(rolledBack(r5, [a5, a6, r5], new Map())).toBe(false);
  });

  it("rolls back a batch built on a rejected one before its index is retaken", () => {
    const a5 = b("5", "100", "A5");
    const a6 = b("6", "110", "A6");
    expect(rolledBack(a6, [a5, a6], new Map([[key(a5), "rejected"]]))).toBe(true);
    expect(rolledBack(a6, [a5, a6], new Map([[key(a5), "pending"]]))).toBe(false);
  });

  it("keeps a batch built on the replacement of a rejected one", () => {
    const a5 = b("5", "100", "A5");
    const r5 = b("5", "120", "B5");
    const r6 = b("6", "130", "B6");
    expect(rolledBack(r6, [a5, r5, r6], new Map([[key(a5), "rejected"]]))).toBe(false);
  });
});
