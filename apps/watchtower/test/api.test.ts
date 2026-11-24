import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ApiBatchDetailV1,
  ApiBatchListV1,
  ApiErrorV1,
  ApiHealthV1,
  ApiReceiptV1,
  canonicalize,
  fromHex,
  keygen,
  SIGNING_CONTEXTS,
  verifyDocument,
} from "@sdiqt/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { createApiServer, TowerStore } from "../src/index.ts";
import { byTx, ROLLUP, setup } from "./fixture.ts";

const POLLED = 1_794_464_647_000 + 600_000;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

/** A tower ticked once over the vector, its API on a free port, the clock `lagS` after the poll. */
async function serve(lagS: number) {
  const b0 = byTx("929C7A21");
  const t = setup({ qstrFor: [b0], now: () => new Date(POLLED) });
  await t.tower.tick();
  const server = createApiServer({
    store: t.store,
    rollupId: ROLLUP,
    now: () => new Date(POLLED + lagS * 1000),
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  closers.push(() => new Promise((r) => server.close(() => r())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const get = async (path: string, method = "GET") => {
    const res = await fetch(`${base}${path}`, { method });
    const text = await res.text();
    return { status: res.status, text, json: JSON.parse(text) as unknown };
  };
  return { ...t, get };
}

describe("watchtower API contract", () => {
  it("answers every route with a body that parses with the shared schema", async () => {
    const { get } = await serve(30);

    const h = await get("/api/health");
    expect(h.status).toBe(200);
    const health = ApiHealthV1.parse(h.json);
    expect(health).toMatchObject({ status: "ok", lag_s: "30", last_poll_height: "10686595" });
    expect(health.last_receipt).not.toBeNull();

    const list = ApiBatchListV1.parse((await get("/api/batches")).json);
    // 9 submissions over 7 indexes: two indexes were rolled back and resubmitted.
    expect(list.batches.map((b) => b.batch_index)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(list.batches.filter((b) => b.submissions === "2")).toHaveLength(2);
    expect(list.batches.every((b) => b.judged === "match")).toBe(true);

    for (const b of list.batches) {
      const d = await get(`/api/batches/${b.batch_index}`);
      expect(d.status).toBe(200);
      const detail = ApiBatchDetailV1.parse(d.json);
      expect(detail.submissions.at(-1)?.submit_tx).toBe(b.submit_tx);
      for (const s of detail.submissions) expect(s.chain).not.toBeNull();

      const r = await get(`/api/receipts/${b.batch_index}`);
      expect(r.status).toBe(200);
      const receipt = ApiReceiptV1.parse(r.json);
      // The body on the wire is the receipt's JCS text, byte for byte.
      expect(r.text).toBe(canonicalize(receipt));
    }
  });

  it("shows chain roots and the proof claim side by side, with the receipt timeline", async () => {
    const { get } = await serve(0);
    const d = ApiBatchDetailV1.parse((await get("/api/batches/0")).json);
    const s = d.submissions.at(-1);
    expect(s?.validity).toBe("proven");
    expect(s?.claim).toMatchObject({ verified: true, sig_mode: "full" });
    expect(s?.claim?.state_root).toBe(s?.chain?.state_root);
    expect(s?.qstr_tx).toMatch(/^[0-9A-F]{64}$/);
    expect(s?.timeline).toEqual([
      { settlement: "final", validity: "proven", issued_at: new Date(POLLED).toISOString() },
    ]);
  });

  it("lists the rolled-back fraud next to its replacement at the same index", async () => {
    const { get } = await serve(0);
    const fraud = byTx("B30CD12C");
    const d = ApiBatchDetailV1.parse((await get(`/api/batches/${fraud.batch_index}`)).json);
    expect(d.submissions).toHaveLength(2);
    const [first, second] = d.submissions;
    expect(first).toMatchObject({
      submit_tx: fraud.txhash,
      judged: "mismatch",
      settlement: "rejected",
    });
    expect(first?.differs.length).toBeGreaterThan(0);
    expect(second).toMatchObject({ judged: "match", settlement: "final" });
  });

  it("serves a receipt whose ML-DSA-87 signature verifies under the tower key", async () => {
    const { get } = await serve(0);
    const r = ApiReceiptV1.parse((await get("/api/receipts/0")).json);
    const { publicKey } = keygen(new Uint8Array(32).fill(5));
    expect(
      verifyDocument(r.body, fromHex(r.signature), publicKey, SIGNING_CONTEXTS.receiptV1),
    ).toBe(true);
  });

  it("returns 503 from /api/health once the last poll is more than 5 minutes old", async () => {
    const { get } = await serve(301);
    const h = await get("/api/health");
    expect(h.status).toBe(503);
    expect(ApiHealthV1.parse(h.json)).toMatchObject({
      status: "stale",
      lag_s: "301",
      max_lag_s: "300",
    });
    expect((await serve(300).then((s) => s.get("/api/health"))).status).toBe(200);
  });

  it("refuses unknown routes, bad indexes, missing batches and writes with an error body", async () => {
    const { get } = await serve(0);
    for (const [path, status] of [
      ["/api/nope", 404],
      ["/api/batches/01", 400],
      ["/api/batches/-1", 400],
      ["/api/batches/999", 404],
      ["/api/receipts/999", 404],
    ] as const) {
      const r = await get(path);
      expect(r.status, path).toBe(status);
      ApiErrorV1.parse(r.json);
    }
  });

  it("refuses writes with 405", async () => {
    const { get } = await serve(0);
    expect((await get("/api/batches", "POST")).status).toBe(405);
  });

  it("returns 503 from /api/health before the first poll", async () => {
    const store = new TowerStore(join(mkdtempSync(join(tmpdir(), "sdiqt-api-")), "t.sqlite"));
    const server = createApiServer({ store, rollupId: ROLLUP });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    closers.push(() => new Promise((r) => server.close(() => r())));
    const res = await fetch(
      `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/health`,
    );
    expect(res.status).toBe(503);
    expect(ApiHealthV1.parse(await res.json())).toMatchObject({
      status: "stale",
      last_poll_at: null,
      last_receipt: null,
      batches: "0",
    });
  });

  it("fills chain roots into rows stored before roots were kept", async () => {
    // Batch 0 is final and proven, so the tick skips it except for this fill.
    const t = setup({ qstrFor: [byTx("929C7A21")], now: () => new Date(POLLED) });
    await t.tower.tick();
    const k = `${byTx("929C7A21").txhash}:0`;
    const row = t.store.get(k);
    if (!row) throw new Error("no row");
    t.store.put({
      ...row,
      prev_state_root: null,
      state_root: null,
      withdrawals_root: null,
      data_hash: null,
    });
    await t.tower.tick();
    expect(t.store.get(k)?.state_root).toBe(byTx("929C7A21").state_root);
  });
});
