import { fromHex, SIGNING_CONTEXTS, verifyDocument } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import { byTx, ROLLUP, setup } from "./fixture.ts";

describe("watchtower", () => {
  it("judges every archived batch like the chain did: the two rolled-back frauds mismatch", async () => {
    const { tower, store } = setup();
    await tower.tick();
    const rows = store.list(ROLLUP);
    expect(rows).toHaveLength(9);
    const bad = rows
      .filter((r) => r.judged === "mismatch")
      .map((r) => r.txhash.slice(0, 8))
      .sort();
    expect(bad).toEqual(["3BC15BD0", "B30CD12C"]);
    expect(rows.find((r) => r.txhash.startsWith("3BC15BD0"))?.settlement).toBe("rejected");
    expect(rows.find((r) => r.txhash.startsWith("2EAA9C1D"))?.settlement).toBe("final");
  });

  it("issues PROVEN receipts for batches with a verified bundle and our QSTR, signed by the tower", async () => {
    const b0 = byTx("929C7A21");
    const { tower, store, keys } = setup({ qstrFor: [b0] });
    await tower.tick();
    const key = `${b0.txhash}:0`;
    const latest = store.latestReceipt(key);
    expect(latest?.receipt.body).toMatchObject({
      settlement: "final",
      validity: "proven",
      batch_index: "0",
    });
    expect(latest?.receipt.body.proof).toMatchObject({ prover_id: "mac-1", chunk_count: "1" });
    const r = latest?.receipt;
    if (!r) throw new Error("no receipt");
    expect(
      verifyDocument(r.body, fromHex(r.signature), keys.publicKey, SIGNING_CONTEXTS.receiptV1),
    ).toBe(true);
    // Others without a QSTR are still proving inside the deadline.
    expect(store.get(`${byTx("FACE91C0").txhash}:0`)?.validity).toBe("proving");
  });

  it("does not call a batch proven when its bundle fails verification", async () => {
    const b0 = byTx("929C7A21");
    const { tower, store, events } = setup({ qstrFor: [b0], verifyValid: false });
    await tower.tick();
    expect(store.get(`${b0.txhash}:0`)).toMatchObject({ validity: "proving" });
    expect(store.get(`${b0.txhash}:0`)?.note).toMatch(/INVALID/);
    expect(events.some((e) => e.event === "bundle_checked" && e.valid === false)).toBe(true);
  });

  it("issues a new receipt only when settlement or validity changes", async () => {
    const { tower, store } = setup({ qstrFor: [byTx("929C7A21")] });
    const first = await tower.tick();
    const second = await tower.tick();
    expect(first.receipts).toBeGreaterThan(0);
    expect(second.receipts).toBe(0);
    expect(store.receipts(`${byTx("929C7A21").txhash}:0`)).toHaveLength(1);
  });
});
