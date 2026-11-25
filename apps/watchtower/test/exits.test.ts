import { DatabaseSync } from "node:sqlite";
import { generateSealKeys } from "@qorechain/qoreseal";
import { decodeQledgerTx, qledgerKeypairFromSeed } from "@qorechain/rdk";
import { exitCancel, type LogEvent, sealExitPacket } from "@sdiqt/operator";
import { toHex } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import { ExitDesk, ExitRefused } from "../src/exits.ts";

const CHAIN = "qorechain-diana";
const ROLLUP = "sdiqt-1";
const TOWER = "qor1tower";
const RECIPIENT = "qor1lk7fdflxvyxes9tudqzgkm65uss2pf5ehh6q63";

const alice = qledgerKeypairFromSeed("11".repeat(32));
const mallory = qledgerKeypairFromSeed("22".repeat(32));

function setup(opts: { post?: boolean } = {}) {
  const kemKeys = generateSealKeys();
  const posts: Uint8Array[] = [];
  const events: LogEvent[] = [];
  const desk = new ExitDesk({
    db: new DatabaseSync(":memory:"),
    chainId: CHAIN,
    rollupId: ROLLUP,
    tower: TOWER,
    kemKeys,
    ...(opts.post === false
      ? {}
      : {
          post: async (data: Uint8Array) => {
            posts.push(data);
            return { txhash: `TX${posts.length}` };
          },
        }),
    log: (e) => events.push(e),
  });
  const pack = (seq: bigint, nonce = 1n, key = alice, release = 100n) =>
    sealExitPacket({
      chainId: CHAIN,
      rollupId: ROLLUP,
      key,
      nonce,
      amountUqor: 2_000_000n,
      recipient: RECIPIENT,
      seq,
      releaseHeight: release,
      tower: TOWER,
      towerKemPublicKey: kemKeys.mlkemPublicKey,
    });
  return { desk, kemKeys, posts, events, pack };
}

const account = toHex(alice.accountId);
const nonces = (n: bigint) => () => n;

describe("exit desk", () => {
  it("holds a packet until its release height, then posts the user's signed withdrawal", async () => {
    const { desk, posts, pack } = setup();
    desk.accept(pack(1n));
    expect(await desk.tick(99n, nonces(1n))).toBe(0);
    expect(desk.view(account)?.status).toBe("held");
    expect(await desk.tick(100n, nonces(1n))).toBe(1);
    expect(desk.view(account)).toMatchObject({ status: "posted", post_tx: "TX1" });
    const tx = decodeQledgerTx(posts[0] as Uint8Array);
    expect(tx?.recipient).toBe(RECIPIENT);
    expect(tx?.amount).toBe(2_000_000n);
    expect(toHex(tx?.publicKey ?? new Uint8Array())).toBe(toHex(alice.publicKey));
    expect(desk.get(account)?.packet).toBeNull();
  });

  it("keeps the newest seq and refuses an older or equal one", async () => {
    const { desk, posts, pack } = setup();
    desk.accept(pack(1n, 1n));
    desk.accept(pack(2n, 2n));
    expect(() => desk.accept(pack(2n, 2n))).toThrow(ExitRefused);
    expect(() => desk.accept(pack(1n, 1n))).toThrow(/not newer/);
    await desk.tick(100n, nonces(2n));
    expect(decodeQledgerTx(posts[0] as Uint8Array)?.nonce).toBe(2n);
  });

  it("drops a stale packet without posting once the account's nonce moved on", async () => {
    const { desk, posts, pack } = setup();
    desk.accept(pack(1n, 1n));
    await desk.tick(100n, nonces(3n));
    expect(posts).toHaveLength(0);
    expect(desk.view(account)?.status).toBe("stale");
  });

  it("honours a signed cancel, and refuses packets up to the cancelled seq", async () => {
    const { desk, posts, pack } = setup();
    desk.accept(pack(3n));
    desk.cancel(exitCancel({ chainId: CHAIN, rollupId: ROLLUP, key: alice, seq: 3n }));
    expect(desk.view(account)?.status).toBe("cancelled");
    await desk.tick(1000n, nonces(1n));
    expect(posts).toHaveLength(0);
    expect(() => desk.accept(pack(2n))).toThrow(/cancelled/);
    desk.accept(pack(4n));
    expect(desk.view(account)?.status).toBe("held");
  });

  it("refuses a cancel or a packet signed by anyone but the account", () => {
    const { desk, pack } = setup();
    desk.accept(pack(1n));
    const forged = exitCancel({ chainId: CHAIN, rollupId: ROLLUP, key: mallory, seq: 9n });
    forged.body.account = account;
    expect(() => desk.cancel(forged)).toThrow(/does not match/);
    const swapped = { ...forged, body: { ...forged.body, public_key: toHex(alice.publicKey) } };
    expect(() => desk.cancel(swapped)).toThrow(/signature invalid/);

    const p = pack(5n);
    const replaced = { ...p, header: { ...p.header, release_height: "1" } };
    expect(() => desk.accept(replaced)).toThrow(/header signature invalid/);
    expect(desk.view(account)?.status).toBe("held");
  });

  it("an outsider's keys cannot open the packet", () => {
    const { pack } = setup();
    const other = setup();
    expect(() => other.desk.accept(pack(1n))).toThrow(/another KEM key/);
  });

  it("rejects a packet whose ciphertext was changed, and posts nothing", async () => {
    const { desk, posts, pack } = setup();
    const p = pack(1n);
    const body = p.envelope.slice("qoreseal:".length);
    const i = body.length - 10;
    const flip = body[i] === "A" ? "B" : "A";
    desk.accept({ ...p, envelope: `qoreseal:${body.slice(0, i)}${flip}${body.slice(i + 1)}` });
    await desk.tick(100n, nonces(1n));
    expect(posts).toHaveLength(0);
    expect(desk.view(account)).toMatchObject({ status: "rejected" });
  });

  it("refuses packets for another rollup or tower", () => {
    const { desk, pack } = setup();
    const p = pack(1n);
    expect(() => desk.accept({ ...p, header: { ...p.header, rollup_id: "other" } })).toThrow(
      /rollup other/,
    );
    expect(() => desk.accept({ ...p, header: { ...p.header, tower: "qor1x" } })).toThrow(
      /sealed to qor1x/,
    );
  });

  it("without a poster (simulate), a due packet stays held", async () => {
    const { desk, pack } = setup({ post: false });
    desk.accept(pack(1n));
    expect(await desk.tick(100n, nonces(1n))).toBe(0);
    expect(desk.view(account)?.status).toBe("held");
  });
});

describe("exit API", () => {
  it("accepts a packet over POST, shows its status without contents, applies a cancel", async () => {
    const { createApiServer, TowerStore } = await import("../src/index.ts");
    const { mkdtempSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const store = new TowerStore(join(mkdtempSync(join(tmpdir(), "exits-")), "t.sqlite"));
    const kemKeys = generateSealKeys();
    const desk = new ExitDesk({
      db: store.db,
      chainId: CHAIN,
      rollupId: ROLLUP,
      tower: TOWER,
      kemKeys,
      log: () => {},
    });
    const server = createApiServer({ store, rollupId: ROLLUP, exits: desk });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as import("node:net").AddressInfo).port}`;
    try {
      const packet = sealExitPacket({
        chainId: CHAIN,
        rollupId: ROLLUP,
        key: alice,
        nonce: 1n,
        amountUqor: 1n,
        recipient: RECIPIENT,
        seq: 1n,
        releaseHeight: 5n,
        tower: TOWER,
        towerKemPublicKey: kemKeys.mlkemPublicKey,
      });
      const post = (path: string, body: unknown) =>
        fetch(`${base}${path}`, { method: "POST", body: JSON.stringify(body) });
      expect((await post("/api/exits", packet)).status).toBe(202);
      expect((await post("/api/exits", packet)).status).toBe(422);
      const got = await fetch(`${base}/api/exits/${account}`);
      const text = await got.text();
      expect(got.status).toBe(200);
      expect(text).not.toContain("qoreseal:");
      expect(JSON.parse(text)).toMatchObject({ status: "held", seq: "1", attempts: "0" });
      const c = exitCancel({ chainId: CHAIN, rollupId: ROLLUP, key: alice, seq: 1n });
      expect((await post("/api/exits/cancel", c)).status).toBe(200);
      expect(await (await fetch(`${base}/api/exits/${account}`)).json()).toMatchObject({
        status: "cancelled",
      });
      expect(
        (await fetch(`${base}/api/exits`, { method: "POST", body: "x".repeat(70_000) })).status,
      ).toBe(413);
      expect((await fetch(`${base}/api/batches`, { method: "POST" })).status).toBe(405);
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
      store.close();
    }
  });
});
