import { readFileSync } from "node:fs";
import type { InboxRecord } from "@sdiqt/archiver";
import { describe, expect, it, vi } from "vitest";
import {
  type BatchPlan,
  type BatchRoots,
  dualSelfCheck,
  InboxReplay,
  Operator,
  planBatch,
  type RustClaim,
  type RustClaimer,
  type Submitter,
  shouldBatch,
} from "../src/index.ts";

const CHAIN = "qorechain-diana";
const ROLLUP = "rdk-v328-e2e-mwd5v89d";
const DIR = new URL(`../../../vectors/archive/${ROLLUP}/`, import.meta.url);
const entries: InboxRecord[] = readFileSync(new URL("inbox.jsonl", DIR), "utf8")
  .trim()
  .split("\n")
  .map((l) => JSON.parse(l));

/** Batch 1 as the chain kept it: entries 5..9 from the state after entry 4. */
function batchOne(): BatchPlan {
  const replay = new InboxReplay(CHAIN, ROLLUP);
  replay.setEntries(entries);
  return planBatch({
    chainId: CHAIN,
    rollupId: ROLLUP,
    batchIndex: 1n,
    point: replay.at(4n),
    records: replay.records(4n, 9n),
    entries: replay.range(4n, 9n),
  });
}

const asClaim = (r: BatchRoots): RustClaim => ({
  inbox_from: r.inboxFrom,
  inbox_end: r.inboxEnd,
  parent_root: r.parentRoot,
  state_root: r.stateRoot,
  withdrawals_root: r.withdrawalsRoot,
  data_hash: r.dataHash,
});

const agreeing = (plan: BatchPlan): RustClaimer => ({ claim: async () => asClaim(plan.roots) });
const flip = (h: string) => `${h.slice(0, -1)}${h.endsWith("0") ? "1" : "0"}`;

describe("planning from the archive", () => {
  it("reproduces the roots the chain kept for batch 1", () => {
    expect(batchOne().roots).toEqual({
      inboxFrom: "4",
      inboxEnd: "9",
      parentRoot: "83274dd8c1e80acbe22bb5fb8bd054f08d5c020ecea632a3b650ffe685f387a7",
      stateRoot: "87e75c9b1402b1ebf3a01c73f9002daada5635e041740e18a24e5d61070d2e8b",
      withdrawalsRoot: "bbf921bdcd57edfaea7e0af48f34befcc9b379ec7662cfac0e8d2eba07b95ff4",
      dataHash: "2fe4dea16bc2ad3ed62d7a2b42b7a8af79add8f87cf9340938ad9894c1fd3a20",
    });
  });

  it("triggers on 20 idle blocks or a full batch, never on own commitments only", () => {
    const pending = entries.slice(4, 6);
    const last = BigInt(pending.at(-1)?.height ?? 0);
    expect(shouldBatch({ pending, tipHeight: last + 19n })).toBe(false);
    expect(shouldBatch({ pending, tipHeight: last + 20n })).toBe(true);
    const own = pending.map((r) => ({ ...r, poster: "qor1me", payload: `51535452${r.payload}` }));
    expect(shouldBatch({ pending: own, tipHeight: last + 99n, operator: "qor1me" })).toBe(false);
  });
});

describe("dual self-check", () => {
  it("passes when both sides agree with the planned roots", async () => {
    const plan = batchOne();
    const r = await dualSelfCheck({
      chainId: CHAIN,
      rollupId: ROLLUP,
      plan,
      submit: plan.roots,
      rust: agreeing(plan),
    });
    expect(r).toEqual({ ok: true, problems: [] });
  });

  it("refuses when the Rust side disagrees", async () => {
    const plan = batchOne();
    const rust: RustClaimer = {
      claim: async () => ({ ...asClaim(plan.roots), state_root: flip(plan.roots.stateRoot) }),
    };
    const r = await dualSelfCheck({
      chainId: CHAIN,
      rollupId: ROLLUP,
      plan,
      submit: plan.roots,
      rust,
    });
    expect(r.ok).toBe(false);
    expect(r.problems.join()).toMatch(/^rust: state_root/);
  });

  it("refuses when the Rust side gives no answer", async () => {
    const plan = batchOne();
    const rust: RustClaimer = { claim: async () => Promise.reject(new Error("exited")) };
    const r = await dualSelfCheck({
      chainId: CHAIN,
      rollupId: ROLLUP,
      plan,
      submit: plan.roots,
      rust,
    });
    expect(r.problems).toEqual(["rust: no claim: exited"]);
  });

  it("refuses a wrong root on both sides", async () => {
    const plan = batchOne();
    const submit = { ...plan.roots, stateRoot: flip(plan.roots.stateRoot) };
    const r = await dualSelfCheck({
      chainId: CHAIN,
      rollupId: ROLLUP,
      plan,
      submit,
      rust: agreeing(plan),
    });
    expect(r.problems.some((p) => p.startsWith("ts: checkQledgerFraud"))).toBe(true);
    expect(r.problems.some((p) => p.startsWith("rust: state_root"))).toBe(true);
  });
});

describe("live submit", () => {
  const operator = (rust: RustClaimer, submit: Submitter) =>
    new Operator({
      client: {} as never,
      chainId: CHAIN,
      rollupId: ROLLUP,
      archiveDir: "unused",
      rust,
      mode: "live",
      submit,
      log: () => {},
    });

  it("a forced disagreement blocks the submit", async () => {
    const plan = batchOne();
    const submit = vi.fn<Submitter>(async () => ({ txhash: "AA" }));
    const rust: RustClaimer = {
      claim: async () => ({ ...asClaim(plan.roots), data_hash: flip(plan.roots.dataHash) }),
    };
    const op = operator(rust, submit);
    expect(await op.submitPlan(plan, plan.roots)).toBe(false);
    expect(submit).not.toHaveBeenCalled();
    expect(op.stats.refused).toBe(1);
  });

  it("an agreeing batch is submitted once", async () => {
    const plan = batchOne();
    const submit = vi.fn<Submitter>(async () => ({ txhash: "AA" }));
    const op = operator(agreeing(plan), submit);
    expect(await op.submitPlan(plan, plan.roots)).toBe(true);
    expect(submit).toHaveBeenCalledTimes(1);
  });
});
