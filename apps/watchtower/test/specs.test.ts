/**
 * The exit packet v1 vectors (`vectors/exit-packet/cases.json`, written by
 * `scripts/exit-vectors.ts`) replayed against the real exit desk.
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sealKeysFromSeed } from "@qorechain/qoreseal";
import { kemKeySha256 } from "@sdiqt/operator";
import { fromHex } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import { ExitDesk, ExitRefused } from "../src/exits.ts";

const cases = JSON.parse(
  readFileSync(new URL("../../../vectors/exit-packet/cases.json", import.meta.url), "utf8"),
);

type Step = { accept: unknown } | { cancel: unknown } | { tick: { height: string; nonce: string } };

interface Case {
  name: string;
  rule?: string;
  steps: Step[];
  refused?: string;
  status?: string;
  reason?: string;
}

/** Run every step; returns the refusal of the last step, if any, and the account's status. */
async function replay(c: Case) {
  const desk = new ExitDesk({
    db: new DatabaseSync(":memory:"),
    chainId: cases.desk.chain_id,
    rollupId: cases.desk.rollup_id,
    tower: cases.desk.tower,
    kemKeys: sealKeysFromSeed(fromHex(cases.desk.tower_kem_seed)),
    post: async () => ({ txhash: "TX" }),
    log: () => {},
  });
  let refused: string | undefined;
  for (const [i, step] of c.steps.entries()) {
    const last = i === c.steps.length - 1;
    try {
      if ("accept" in step) desk.accept(step.accept);
      else if ("cancel" in step) desk.cancel(step.cancel);
      else await desk.tick(BigInt(step.tick.height), () => BigInt(step.tick.nonce));
    } catch (err) {
      if (!(err instanceof ExitRefused) || !last) throw err;
      refused = err.message;
    }
  }
  const account = (c.steps[0] as { accept?: { header: { account: string } } }).accept?.header
    .account;
  const view = account ? desk.view(account) : undefined;
  return { refused, status: view?.status, reason: view?.reason };
}

describe("exit packet vectors", () => {
  it("the desk uses the KEM key the vectors name", () => {
    const keys = sealKeysFromSeed(fromHex(cases.desk.tower_kem_seed));
    expect(kemKeySha256(keys.mlkemPublicKey)).toBe(cases.desk.tower_kem_sha256);
  });

  it.each(cases.valid as Case[])("$name", async (c) => {
    const r = await replay(c);
    expect(r.refused).toBeUndefined();
    expect(r.status).toBe(c.status);
  });

  it.each(cases.invalid as Case[])("$name ($rule)", async (c) => {
    const r = await replay(c);
    if (c.refused !== undefined) {
      expect(r.refused).toContain(c.refused);
    } else {
      expect(r.refused).toBeUndefined();
      expect(r.status).toBe(c.status);
      if (c.reason !== undefined) expect(r.reason).toContain(c.reason);
    }
  });
});
