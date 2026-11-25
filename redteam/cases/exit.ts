/**
 * Case 6: stale and replayed exit packets. Packets are sealed with the
 * operator's `sealExitPacket` (QoreSeal, ML-KEM-1024) and handed to the
 * watchtower's `ExitDesk` over an in-memory database. `post` records what the
 * desk would send to the inbox; nothing reaches a chain.
 */
import { DatabaseSync } from "node:sqlite";
import { generateSealKeys } from "@qorechain/qoreseal";
import { qledgerKeypairFromSeed } from "@qorechain/rdk";
import { sealExitPacket } from "@sdiqt/operator";
import { type ExitPacketV1, toHex } from "@sdiqt/protocol";
import { ExitDesk } from "@sdiqt/watchtower";
import { ACCEPTED, type Case, outcome } from "./common.ts";

const CHAIN = "qorechain-diana";
const ROLLUP = "sdiqt-1";
const TOWER = "qor1redteamtower";
const RECIPIENT = "qor1lk7fdflxvyxes9tudqzgkm65uss2pf5ehh6q63";
const RELEASE = 100n;
const alice = qledgerKeypairFromSeed("11".repeat(32));
const account = toHex(alice.accountId);

function desk() {
  const kemKeys = generateSealKeys();
  const posts: Uint8Array[] = [];
  const d = new ExitDesk({
    db: new DatabaseSync(":memory:"),
    chainId: CHAIN,
    rollupId: ROLLUP,
    tower: TOWER,
    kemKeys,
    post: async (data) => {
      posts.push(data);
      return { txhash: `POST${posts.length}` };
    },
    log: () => {},
    now: () => new Date(0),
  });
  const pack = (seq: bigint, nonce: bigint) =>
    sealExitPacket({
      chainId: CHAIN,
      rollupId: ROLLUP,
      key: alice,
      nonce,
      amountUqor: 2_000_000n,
      recipient: RECIPIENT,
      seq,
      releaseHeight: RELEASE,
      tower: TOWER,
      towerKemPublicKey: kemKeys.mlkemPublicKey,
    });
  return { d, posts, pack };
}

/** Accept `packet`, tick at the release height with the account at `nonce`, report the row. */
async function release(
  s: ReturnType<typeof desk>,
  packet: ExitPacketV1,
  nonce: bigint,
): Promise<string> {
  const refused = await outcome(() => s.d.accept(packet));
  if (refused !== ACCEPTED) return refused;
  await s.d.tick(RELEASE, () => nonce);
  const v = s.d.view(account);
  if (v?.status === "posted") return `${ACCEPTED} (posted ${s.posts.length})`;
  return `${v?.status}: ${v?.reason} (posted ${s.posts.length})`;
}

export async function staleExit(): Promise<Case> {
  const honest = desk();
  const original = honest.pack(1n, 1n);
  const control = await release(honest, original, 1n);

  const used = desk();
  const stale = await release(used, used.pack(1n, 1n), 2n);

  // The same packet once more, after the desk posted it.
  const replay = await outcome(() => honest.d.accept(original));

  // The posted packet with its seq raised; the header signature covers seq.
  const resigned = await outcome(() =>
    honest.d.accept({ ...original, header: { ...original.header, seq: "2" } }),
  );

  return {
    id: "6",
    title: "Stale exit packet: nonce already used",
    code: [
      "apps/watchtower/src/exits.ts: ExitDesk.accept, ExitDesk.tick",
      "apps/operator/src/exit-packet.ts: openExitPacket",
    ],
    control: { input: "packet seq 1 nonce 1, account nonce 1 at the release height", got: control },
    attempts: [
      {
        attack: "packet for nonce 1 released after the account already used nonce 1 (nonce now 2)",
        expect: /^stale: account nonce is 2, packet nonce 1 \(posted 0\)$/,
        got: stale,
      },
      {
        attack: "the posted packet submitted again",
        expect: /^seq 1 is not newer than stored seq 1$/,
        got: replay,
      },
      {
        attack: "the posted packet with header seq raised to 2, signature kept",
        expect: /^header signature invalid$/,
        got: resigned,
      },
    ],
  };
}
