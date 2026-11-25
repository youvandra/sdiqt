import type { AddressInfo } from "node:net";
import {
  ApiBatchListV1,
  ApiHealthV1,
  ApiReceiptV1,
  ApiRollupListV1,
  type ReceiptBodyV1,
} from "@sdiqt/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { checkable, createApiServer, Fleet, type Tickable } from "../src/index.ts";
import { byTx, ROLLUP, setup } from "./fixture.ts";

const POLLED = 1_794_464_647_000 + 600_000;
const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of closers.splice(0)) await c();
});

describe("watch-only tower", () => {
  it("re-executes and signs receipts but never claims a proof", async () => {
    // Batch 6 still pending on chain: a proving tower would call it `proving`.
    const t = setup({ watchOnly: true, status: (i) => (i === "6" ? "submitted" : undefined) });
    await t.tower.tick();
    const rows = t.store.list(ROLLUP);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.validity === "unproven" || r.validity === "mismatch")).toBe(true);
    expect(rows.some((r) => r.settlement === "pending")).toBe(true);
    for (const r of rows) {
      const body = t.store.latestReceipt(r.key)?.receipt.body as ReceiptBodyV1 | undefined;
      if (body) expect(body.proof).toBeNull();
    }
    expect(t.events.some((e) => e.event === "bundle_checked")).toBe(false);
  });

  it("leaves settled batches alone on the next tick", async () => {
    const t = setup({ watchOnly: true });
    await t.tower.tick();
    const before = t.store.list(ROLLUP).map((r) => r.updated_at);
    const r = await t.tower.tick();
    expect(r.receipts).toBe(0);
    expect(t.store.list(ROLLUP).map((x) => x.updated_at)).toEqual(before);
  });
});

describe("rollup discovery", () => {
  it("keeps qledger-v1 rollups with a based inbox, minus excluded ones", () => {
    const ids = checkable(
      [
        { rollupId: "b", executionVm: "qledger-v1", sequencing: "based" },
        { rollupId: "a", executionVm: "qledger-v1", sequencing: "based" },
        { rollupId: "snark", executionVm: "", sequencing: "" },
        { rollupId: "seq", executionVm: "qledger-v1", sequencing: "sequencer" },
        { rollupId: "ours", executionVm: "qledger-v1", sequencing: "based" },
      ],
      ["ours"],
    );
    expect(ids).toEqual(["a", "b"]);
  });
});

describe("fleet", () => {
  it("keeps ticking the other rollups when one fails, and adds new ones", async () => {
    let found = ["a", "b"];
    const ticked: string[] = [];
    const events: Array<Record<string, unknown>> = [];
    const fleet = new Fleet({
      discover: async () => found,
      make: (id): Tickable => ({
        tick: async () => {
          ticked.push(id);
          if (id === "a") throw new Error("node down");
          return { batches: 2, receipts: 1 };
        },
      }),
      log: (e) => events.push(e),
      rediscoverEvery: 2,
    });
    expect(await fleet.tick()).toEqual({ rollups: 2, batches: 2, receipts: 1, failed: 1 });
    found = ["a", "b", "c"];
    await fleet.tick(); // no rediscovery on this tick
    expect(fleet.ids).toEqual(["a", "b"]);
    await fleet.tick();
    expect(fleet.ids).toEqual(["a", "b", "c"]);
    expect(ticked).toEqual(["a", "b", "a", "b", "a", "b", "c"]);
    expect(events.filter((e) => e.event === "error" && e.rollup === "a")).toHaveLength(3);
  });

  it("logs a failed discovery and keeps the rollups it has", async () => {
    let fail = false;
    const events: Array<Record<string, unknown>> = [];
    const fleet = new Fleet({
      discover: async () => {
        if (fail) throw new Error("rest 502");
        return ["a"];
      },
      make: () => ({ tick: async () => ({ batches: 0, receipts: 0 }) }),
      log: (e) => events.push(e),
      rediscoverEvery: 1,
    });
    await fleet.tick();
    fail = true;
    await fleet.tick();
    expect(fleet.ids).toEqual(["a"]);
    expect(events.some((e) => e.event === "discover_failed")).toBe(true);
  });
});

describe("rollup API", () => {
  async function serve() {
    const ref = setup({ qstrFor: [byTx("929C7A21")], now: () => new Date(POLLED) });
    await ref.tower.tick();
    const other = setup({ watchOnly: true, now: () => new Date(POLLED) });
    await other.tower.tick();
    const server = createApiServer({
      store: ref.store,
      rollupId: ROLLUP,
      now: () => new Date(POLLED + 30_000),
      rollups: () => [
        { id: ROLLUP, store: ref.store, tier: "stark" },
        { id: "other-1", store: other.store, tier: "reexec" },
      ],
    });
    // The second store holds the vector under its own id; serve it as `other-1`.
    other.store.db.exec(`UPDATE batches SET rollup_id = 'other-1'`);
    other.store.db.exec(`UPDATE polls SET rollup_id = 'other-1'`);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    closers.push(() => new Promise((r) => server.close(() => r())));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    return async (path: string, method = "GET") => {
      const res = await fetch(`${base}${path}`, { method });
      return { status: res.status, json: (await res.json()) as unknown };
    };
  }

  it("lists every rollup with its tier, the reference first", async () => {
    const get = await serve();
    const list = ApiRollupListV1.parse((await get("/api/rollups")).json);
    expect(list.reference).toBe(ROLLUP);
    expect(list.rollups.map((r) => [r.rollup_id, r.tier])).toEqual([
      [ROLLUP, "stark"],
      ["other-1", "reexec"],
    ]);
    const [ref, other] = list.rollups;
    expect(ref?.proven).toBe("1");
    expect(other?.proven).toBe("0");
    expect(other?.batches).toBe("7");
    expect(other?.submissions).toBe("9");
    expect(other?.match).toBe("7");
    expect(other?.status).toBe("ok");
  });

  it("serves health, batches and receipts per rollup", async () => {
    const get = await serve();
    const h = ApiHealthV1.parse((await get("/api/r/other-1/health")).json);
    expect(h.rollup_id).toBe("other-1");
    const list = ApiBatchListV1.parse((await get("/api/r/other-1/batches")).json);
    expect(list.batches.every((b) => !b.proven)).toBe(true);
    expect((await get("/api/r/other-1/batches/0")).status).toBe(200);
    const r = await get("/api/r/other-1/receipts/0");
    expect(r.status).toBe(200);
    expect(ApiReceiptV1.parse(r.json).body.proof).toBeNull();
  });

  it("refuses unknown rollups, bad ids and writes", async () => {
    const get = await serve();
    expect((await get("/api/r/nope/health")).status).toBe(404);
    expect((await get("/api/r/..%2F/health")).status).toBe(404);
    expect((await get("/api/r/other-1/batches/x")).status).toBe(400);
    expect((await get("/api/r/other-1/health/extra")).status).toBe(404);
    expect((await get("/api/rollups", "POST")).status).toBe(405);
  });
});
