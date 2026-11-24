import { describe, expect, it, vi } from "vitest";
import {
  ChainError,
  feeForGas,
  parseGasPrice,
  retryingFetch,
  SafeTx,
  SpendCap,
} from "../src/index.ts";

const price = parseGasPrice("0.15uqor");
const noSleep = () => Promise.resolve();

describe("gas price and fee", () => {
  it("parses decimal uqor prices exactly", () => {
    expect(price).toEqual({ gasPriceNumerator: 15n, gasPriceScale: 100n });
    expect(() => parseGasPrice("0.15qor")).toThrow();
  });

  it("adds 30% headroom and rounds up", () => {
    // 100,000 gas -> 130,000 adjusted -> 19,500 uqor
    expect(feeForGas(100_000n, price)).toBe(19_500n);
    expect(feeForGas(1n, price)).toBe(1n);
  });
});

describe("spend cap", () => {
  it("refuses a spend past the daily limit and resets the next UTC day", () => {
    let now = new Date("2026-11-27T23:00:00Z");
    const cap = new SpendCap(1_000n, () => now);
    cap.reserve(900n, "a");
    expect(() => cap.reserve(200n, "b")).toThrow(ChainError);
    cap.release(100n);
    cap.reserve(200n, "c");
    now = new Date("2026-11-28T00:00:01Z");
    expect(cap.snapshot()).toEqual({ day: "2026-11-28", spentUqor: 0n });
  });

  it("restores the same day's spend only", () => {
    const now = () => new Date("2026-11-27T10:00:00Z");
    expect(new SpendCap(10n, now, { day: "2026-11-27", spentUqor: 7n }).snapshot().spentUqor).toBe(
      7n,
    );
    expect(new SpendCap(10n, now, { day: "2026-11-26", spentUqor: 7n }).snapshot().spentUqor).toBe(
      0n,
    );
  });
});

describe("simulate-first transactions", () => {
  const ok = { code: 0, transactionHash: "AB", height: 1 } as never;

  it("never broadcasts when simulation fails", async () => {
    const send = vi.fn(async () => ok);
    const tx = new SafeTx(
      { simulate: () => Promise.reject(new Error("bad msg")) },
      { ...price, cap: new SpendCap(10n ** 9n) },
    );
    await expect(tx.run({ label: "post", messages: [], send })).rejects.toMatchObject({
      code: "simulate_failed",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("never broadcasts past the spend cap", async () => {
    const send = vi.fn(async () => ok);
    const tx = new SafeTx(
      { simulate: async () => 100_000 },
      { ...price, cap: new SpendCap(19_499n) },
    );
    await expect(tx.run({ label: "post", messages: [], send })).rejects.toMatchObject({
      code: "spend_cap",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("counts the amount moved and reports a failed delivery", async () => {
    const cap = new SpendCap(10n ** 9n);
    const tx = new SafeTx({ simulate: async () => 100_000 }, { ...price, cap });
    const out = await tx.run({
      label: "deposit",
      messages: [],
      amountUqor: 5_000_000n,
      send: async () => ok,
    });
    expect(out.feeUqor).toBe(19_500n);
    expect(cap.snapshot().spentUqor).toBe(5_019_500n);
    const failed = { code: 51, transactionHash: "CD", rawLog: "no fraud" } as never;
    await expect(
      tx.run({ label: "challenge", messages: [], send: async () => failed }),
    ).rejects.toMatchObject({
      code: "tx_failed",
    });
  });

  it("keeps a failed tx's fee on the cap but gives back the amount it did not move", async () => {
    const cap = new SpendCap(10n ** 10n);
    const tx = new SafeTx({ simulate: async () => 100_000 }, { ...price, cap });
    const failed = { code: 51, transactionHash: "CD", rawLog: "already challenged" } as never;
    await expect(
      tx.run({
        label: "challenge",
        messages: [],
        amountUqor: 1_000_000_000n,
        send: async () => failed,
      }),
    ).rejects.toMatchObject({ code: "tx_failed" });
    expect(cap.snapshot().spentUqor).toBe(19_500n);
  });
});

describe("retrying fetch", () => {
  it("retries 429 and 5xx, then returns the answer", async () => {
    const statuses = [429, 503, 200];
    const inner = vi.fn(async () => new Response("x", { status: statuses.shift() ?? 200 }));
    const res = await retryingFetch({ fetch: inner as never, sleep: noSleep })("https://x/");
    expect(res.status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(3);
  });

  it("returns 404 at once and sets a user agent", async () => {
    const inner = vi.fn(async (_: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("user-agent")).toBe("sdiqt/0.1");
      return new Response("", { status: 404 });
    });
    const res = await retryingFetch({ fetch: inner as never, sleep: noSleep })("https://x/");
    expect(res.status).toBe(404);
    expect(inner).toHaveBeenCalledTimes(1);
  });
});
