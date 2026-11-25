import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "../src/lib/api.ts";

const health = {
  status: "stale",
  rollup_id: "skyproof-1",
  last_poll_at: "2026-11-24T23:20:22.497Z",
  last_poll_height: "10700000",
  lag_s: "400",
  max_lag_s: "300",
  challenge_window_s: null,
  batches: "8",
  last_receipt: null,
};

function respond(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("watchtower client", () => {
  it("accepts a stale health answer (503) and parses it", async () => {
    respond(503, health);
    await expect(api.health()).resolves.toMatchObject({ status: "stale", lag_s: "400" });
  });

  it("turns an error body into an ApiError with the tower's message", async () => {
    respond(404, { error: "no batch 999 on skyproof-1" });
    const err = await api.batch("999").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 404, message: "no batch 999 on skyproof-1" });
  });

  it("refuses a response that does not match the shared schema", async () => {
    respond(200, { rollup_id: "skyproof-1", batches: [{ batch_index: 1 }] });
    await expect(api.batches()).rejects.toThrow();
  });
});
