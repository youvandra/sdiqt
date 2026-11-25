import { describe, expect, it } from "vitest";
import {
  decideTick,
  type HeartbeatAccount,
  type HeartbeatChain,
  type HeartbeatConfig,
  type HeartbeatEnv,
  type HeartbeatPost,
  newHeartbeatState,
  reservedFee,
  runHeartbeat,
} from "../src/index.ts";

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const A: HeartbeatAccount = { name: "a", id: new Uint8Array(32).fill(0xaa) };
const B: HeartbeatAccount = { name: "b", id: new Uint8Array(32).fill(0xbb) };
const FEE = 71_511n;

const config = (over: Partial<HeartbeatConfig> = {}): HeartbeatConfig => ({
  pair: [A, B],
  amountUqor: 1n,
  intervalMs: 600_000,
  pollMs: 30_000,
  maxWaitMs: 120_000,
  maxTicks: 4,
  capUqor: 1_000_000n,
  maxErrors: 3,
  send: true,
  ...over,
});

/** A mock chain whose archive executes each broadcast after `lagReads` ledger reads. */
function mockChain(opts: { lagReads?: number; dropAfter?: number; failCode?: number } = {}) {
  const accts = new Map<string, { balance: bigint; nonce: bigint }>([
    [hex(A.id), { balance: 5n, nonce: 2n }],
    [hex(B.id), { balance: 0n, nonce: 0n }],
  ]);
  let head = 9n;
  const inflight: { post: HeartbeatPost; readsLeft: number }[] = [];
  const broadcasts: HeartbeatPost[] = [];
  const simulations: HeartbeatPost[] = [];
  const execute = (p: HeartbeatPost) => {
    const from = accts.get(hex(p.from.id)) ?? { balance: 0n, nonce: 0n };
    const to = accts.get(hex(p.to.id)) ?? { balance: 0n, nonce: 0n };
    if (p.nonce !== from.nonce || from.balance < p.amountUqor) return; // qledger skips it
    accts.set(hex(p.from.id), { balance: from.balance - p.amountUqor, nonce: from.nonce + 1n });
    accts.set(hex(p.to.id), { balance: to.balance + p.amountUqor, nonce: to.nonce });
  };
  const chain: HeartbeatChain = {
    async readLedger() {
      for (const f of inflight) f.readsLeft -= 1;
      while (inflight[0] && inflight[0].readsLeft < 0) {
        const f = inflight.shift();
        if (f) {
          head += 1n;
          execute(f.post);
        }
      }
      const snapshot = new Map([...accts].map(([k, v]) => [k, { ...v }]));
      return {
        head,
        ledger: { get: (id) => snapshot.get(hex(id)) ?? { balance: 0n, nonce: 0n } },
      };
    },
    async simulate(p) {
      simulations.push(p);
      return { gas: 366_721n, feeUqor: FEE, bytes: 3_800 };
    },
    async broadcast(p) {
      broadcasts.push(p);
      if (opts.failCode) return { hash: "F".repeat(64), code: opts.failCode, feeUqor: FEE };
      if (opts.dropAfter === undefined || broadcasts.length <= opts.dropAfter) {
        inflight.push({ post: p, readsLeft: opts.lagReads ?? 0 });
      }
      return { hash: `${broadcasts.length}`.padStart(64, "0"), code: 0, height: 1, feeUqor: FEE };
    },
  };
  return { chain, broadcasts, simulations, accts };
}

function mockEnv(stopAfterMs = Number.POSITIVE_INFINITY) {
  const events: Record<string, unknown>[] = [];
  let clock = 0;
  const env: HeartbeatEnv = {
    async sleep(ms) {
      clock += ms;
    },
    stopRequested: () => clock >= stopAfterMs,
    log: (e) => events.push(e),
  };
  return { env, events, elapsed: () => clock };
}

describe("heartbeat scheduling", () => {
  it("alternates direction with the archived nonces and stops at max ticks", async () => {
    const { chain, broadcasts } = mockChain();
    const { env, events, elapsed } = mockEnv();
    const r = await runHeartbeat(config(), chain, env);
    expect(r.reason).toBe("max_ticks");
    expect(broadcasts.map((p) => [p.from.name, p.to.name, p.nonce])).toEqual([
      ["a", "b", 2n],
      ["b", "a", 0n],
      ["a", "b", 3n],
      ["b", "a", 1n],
    ]);
    // Three intervals between four posts; no sleep after the last one.
    expect(elapsed()).toBe(3 * 600_000);
    expect(events.filter((e) => e.event === "posted")).toHaveLength(4);
    expect(events.at(-1)).toMatchObject({
      event: "stop",
      reason: "max_ticks",
      spent_qor: "0.286044",
    });
  });

  it("waits for the archive to show the previous post before reusing the sender", async () => {
    const { chain, broadcasts } = mockChain({ lagReads: 2 });
    const { env, events } = mockEnv();
    const r = await runHeartbeat(config({ maxTicks: 3 }), chain, env);
    expect(r.reason).toBe("max_ticks");
    expect(broadcasts.map((p) => p.nonce)).toEqual([2n, 0n, 3n]);
    expect(events.some((e) => e.event === "wait" && e.reason === "archive_lag")).toBe(true);
  });

  it("stops with lost_post when a broadcast never reaches the archive", async () => {
    const { chain, broadcasts } = mockChain({ dropAfter: 1 });
    const { env } = mockEnv();
    const r = await runHeartbeat(config({ maxTicks: 10 }), chain, env);
    expect(r.reason).toBe("lost_post");
    expect(broadcasts).toHaveLength(2);
  });

  it("stops when the stop file appears during the interval", async () => {
    const { chain, broadcasts } = mockChain();
    const { env } = mockEnv(900_000);
    const r = await runHeartbeat(config({ maxTicks: 10 }), chain, env);
    expect(r.reason).toBe("stop_file");
    expect(broadcasts).toHaveLength(2);
  });

  it("stops on a failed transaction", async () => {
    const { chain, broadcasts } = mockChain({ failCode: 11 });
    const { env } = mockEnv();
    const r = await runHeartbeat(config(), chain, env);
    expect(r.reason).toBe("tx_failed");
    expect(broadcasts).toHaveLength(1);
  });

  it("stops after repeated read errors", async () => {
    const { chain } = mockChain();
    chain.readLedger = async () => {
      throw new Error("fetch failed");
    };
    const { env, events } = mockEnv();
    const r = await runHeartbeat(config(), chain, env);
    expect(r.reason).toBe("errors");
    expect(events.filter((e) => e.event === "error")).toHaveLength(3);
  });
});

describe("heartbeat cap", () => {
  it("never lets fees pass the cap, counting 10% headroom", async () => {
    // One spent fee plus one reserved fee: room for two posts, never a third.
    const cap = FEE + reservedFee(FEE);
    const { chain, broadcasts } = mockChain();
    const { env, events } = mockEnv();
    const r = await runHeartbeat(config({ maxTicks: 10, capUqor: cap }), chain, env);
    expect(r.reason).toBe("cap");
    expect(broadcasts).toHaveLength(2);
    expect(r.state.spentUqor).toBeLessThanOrEqual(cap);
    expect(events.at(-1)).toMatchObject({ event: "stop", reason: "cap" });
  });

  it("refuses the first post when one fee is above the cap", async () => {
    const { chain, broadcasts } = mockChain();
    const { env } = mockEnv();
    const r = await runHeartbeat(config({ capUqor: FEE }), chain, env);
    expect(r.reason).toBe("cap");
    expect(broadcasts).toHaveLength(0);
  });
});

describe("heartbeat simulate", () => {
  it("never broadcasts and walks the nonces on a local overlay", async () => {
    const { chain, broadcasts, simulations, accts } = mockChain();
    const { env, events } = mockEnv();
    const r = await runHeartbeat(config({ send: false, maxTicks: 3 }), chain, env);
    expect(r.reason).toBe("max_ticks");
    expect(broadcasts).toHaveLength(0);
    expect(simulations.map((p) => [p.from.name, p.nonce])).toEqual([
      ["a", 2n],
      ["b", 0n],
      ["a", 3n],
    ]);
    expect(accts.get(hex(A.id))).toEqual({ balance: 5n, nonce: 2n });
    expect(events.filter((e) => e.event === "would_post")[0]).toMatchObject({
      mode: "simulate",
      from: "a",
      to: "b",
      nonce: "2",
      amount_uqor: "1",
      fee_qor: "0.071511",
      bytes: 3_800,
    });
  });
});

describe("decideTick", () => {
  it("stops when the sender cannot cover the amount", () => {
    const state = newHeartbeatState();
    state.direction = 1;
    const ledger = { get: () => ({ balance: 0n, nonce: 0n }) };
    expect(decideTick(state, ledger, config())).toMatchObject({ kind: "stop", reason: "balance" });
  });
});
