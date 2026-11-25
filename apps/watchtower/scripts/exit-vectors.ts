/**
 * Write the exit packet v1 vectors (`vectors/exit-packet/cases.json`) that
 * `specs/exit-packet-v1.md` cites.
 *
 *   node apps/watchtower/scripts/exit-vectors.ts          write the file
 *   node apps/watchtower/scripts/exit-vectors.ts --check  fail if the committed file differs
 *
 * Every key comes from a fixed seed, the envelope is sealed with fixed entropy
 * and the header and cancel signatures are deterministic ML-DSA-44, so a second
 * run writes the same bytes. `test/specs.test.ts` replays each case against the
 * real exit desk. The JSON Schemas are written by
 * `packages/protocol/scripts/vectors.ts`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { ml_dsa44 } from "@noble/post-quantum/ml-dsa.js";
import { envelopeToText, sealKeysFromSeed } from "@qorechain/qoreseal";
import { sealEntropyLength, sealWithEntropy } from "@qorechain/qoreseal/testing";
import { encodeQledgerTx, qledgerKeypairFromSeed, signQledgerTx } from "@qorechain/rdk";
import { kemKeySha256 } from "@sdiqt/operator";
import {
  canonicalBytes,
  EXIT_CANCEL_CONTEXT,
  EXIT_PACKET_PURPOSE,
  type ExitCancelBodyV1,
  type ExitHeaderV1,
  exitHeaderBytes,
  toHex,
} from "@sdiqt/protocol";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const OUT = "vectors/exit-packet/cases.json";
const GENERATOR = "apps/watchtower/scripts/exit-vectors.ts";

const CHAIN = "qorechain-diana";
const ROLLUP = "sdiqt-1";
const TOWER = "qor1tower";
const RECIPIENT = "qor1lk7fdflxvyxes9tudqzgkm65uss2pf5ehh6q63";
const TOWER_SEED = "33".repeat(32);
const OTHER_TOWER_SEED = "44".repeat(32);

const alice = qledgerKeypairFromSeed("11".repeat(32));
const mallory = qledgerKeypairFromSeed("22".repeat(32));
const tower = sealKeysFromSeed(Buffer.from(TOWER_SEED, "hex"));
const otherTower = sealKeysFromSeed(Buffer.from(OTHER_TOWER_SEED, "hex"));
const utf8 = new TextEncoder();

type Key = typeof alice;

const sign = (doc: ExitHeaderV1 | ExitCancelBodyV1, key: Key, context: string = doc.purpose) =>
  toHex(
    ml_dsa44.sign(canonicalBytes(doc), key.secretKey, {
      context: utf8.encode(context),
      extraEntropy: false,
    }),
  );

function entropy(label: string): Uint8Array {
  const n = sealEntropyLength("mlkem", 1);
  const tag = utf8.encode(`sdiqt exit vector ${label}`);
  return Uint8Array.from({ length: n }, (_, i) => (tag[i % tag.length] as number) ^ i);
}

interface PackInput {
  label: string;
  key?: Key;
  seq?: bigint;
  nonce?: bigint;
  release?: bigint;
  /** Nonce of the sealed withdrawal when it should differ from the header's. */
  txNonce?: bigint;
  /** Seal a transfer instead of a withdrawal. */
  transfer?: boolean;
  sealTo?: typeof tower;
  header?: Partial<ExitHeaderV1>;
  /** Sign with this key instead of the header's. */
  signer?: Key;
  context?: string;
  /** Header fields changed after signing and sealing. */
  after?: Partial<ExitHeaderV1>;
}

function pack(i: PackInput) {
  const key = i.key ?? alice;
  const nonce = i.nonce ?? 1n;
  const tx = signQledgerTx({
    chainId: CHAIN,
    rollupId: ROLLUP,
    secretKey: key.secretKey,
    publicKey: key.publicKey,
    nonce: i.txNonce ?? nonce,
    amount: 2_000_000n,
    ...(i.transfer ? { to: mallory.accountId } : { recipient: RECIPIENT }),
  });
  const header: ExitHeaderV1 = {
    v: "1",
    purpose: EXIT_PACKET_PURPOSE,
    chain_id: CHAIN,
    rollup_id: ROLLUP,
    account: toHex(key.accountId),
    public_key: toHex(key.publicKey),
    seq: (i.seq ?? 1n).toString(),
    nonce: nonce.toString(),
    release_height: (i.release ?? 100n).toString(),
    tower: TOWER,
    tower_kem_sha256: kemKeySha256(tower.mlkemPublicKey),
    ...i.header,
  };
  const envelope = sealWithEntropy(
    {
      chainId: header.chain_id,
      purpose: EXIT_PACKET_PURPOSE,
      recipients: [{ mlkemPublicKey: (i.sealTo ?? tower).mlkemPublicKey }],
      plaintext: encodeQledgerTx(tx),
      aad: exitHeaderBytes(header),
      mode: "mlkem",
    },
    entropy(i.label),
  );
  return {
    header: { ...header, ...i.after },
    header_sig: sign(header, i.signer ?? key, i.context),
    envelope: envelopeToText(envelope),
  };
}

function cancel(seq: bigint, opts: { key?: Key; signer?: Key; chain?: string } = {}) {
  const key = opts.key ?? alice;
  const body: ExitCancelBodyV1 = {
    v: "1",
    purpose: EXIT_CANCEL_CONTEXT,
    chain_id: opts.chain ?? CHAIN,
    rollup_id: ROLLUP,
    account: toHex(key.accountId),
    public_key: toHex(key.publicKey),
    seq: seq.toString(),
  };
  return { body, sig: sign(body, opts.signer ?? key) };
}

const good = pack({ label: "good" });
const tick = (height: number, nonce: number) => ({
  tick: { height: String(height), nonce: String(nonce) },
});

const cases = {
  spec: "specs/exit-packet-v1.md",
  generator: GENERATOR,
  desk: {
    chain_id: CHAIN,
    rollup_id: ROLLUP,
    tower: TOWER,
    tower_kem_seed: TOWER_SEED,
    tower_kem_sha256: kemKeySha256(tower.mlkemPublicKey),
  },
  account_seed: "11".repeat(32),
  valid: [
    {
      name: "held until the release height, then posted",
      steps: [{ accept: good }, tick(99, 1), tick(100, 1)],
      status: "posted",
    },
    {
      name: "a higher seq replaces the stored packet",
      steps: [
        { accept: good },
        { accept: pack({ label: "seq2", seq: 2n, nonce: 2n }) },
        tick(100, 2),
      ],
      status: "posted",
    },
    {
      name: "a cancel drops the held packet",
      steps: [{ accept: good }, { cancel: cancel(1n) }],
      status: "cancelled",
    },
  ],
  invalid: [
    {
      name: "unknown header field",
      rule: "EXIT-1",
      steps: [{ accept: { ...good, header: { ...good.header, memo: "x" } } }],
      refused: "not an exit packet v1",
    },
    {
      name: "envelope without the qoreseal: prefix",
      rule: "EXIT-1",
      steps: [{ accept: { ...good, envelope: good.envelope.replace("qoreseal:", "seal:") } }],
      refused: "not an exit packet v1",
    },
    {
      name: "header version 2",
      rule: "EXIT-1",
      steps: [{ accept: { ...good, header: { ...good.header, v: "2" } } }],
      refused: "not an exit packet v1",
    },
    {
      name: "packet for another chain",
      rule: "EXIT-2",
      steps: [{ accept: pack({ label: "chain", header: { chain_id: "qorechain-mainnet" } }) }],
      refused: "packet is for chain qorechain-mainnet",
    },
    {
      name: "packet for another rollup",
      rule: "EXIT-2",
      steps: [{ accept: pack({ label: "rollup", header: { rollup_id: "sdiqt-2" } }) }],
      refused: "packet is for rollup sdiqt-2",
    },
    {
      name: "packet sealed to another tower account",
      rule: "EXIT-3",
      steps: [{ accept: pack({ label: "tower", header: { tower: "qor1other" } }) }],
      refused: "packet is sealed to qor1other",
    },
    {
      name: "packet naming another KEM key",
      rule: "EXIT-3",
      steps: [
        {
          accept: pack({
            label: "kem",
            sealTo: otherTower,
            header: { tower_kem_sha256: kemKeySha256(otherTower.mlkemPublicKey) },
          }),
        },
      ],
      refused: "packet is sealed to another KEM key",
    },
    {
      name: "account id of another key",
      rule: "EXIT-4",
      steps: [
        {
          accept: pack({ label: "account", header: { account: toHex(mallory.accountId) } }),
        },
      ],
      refused: "account id does not match the public key",
    },
    {
      name: "header signed by another account",
      rule: "EXIT-5",
      steps: [{ accept: pack({ label: "signer", signer: mallory }) }],
      refused: "header signature invalid",
    },
    {
      name: "header signed under the cancel context",
      rule: "EXIT-5",
      steps: [{ accept: pack({ label: "context", context: EXIT_CANCEL_CONTEXT }) }],
      refused: "header signature invalid",
    },
    {
      name: "release height changed after signing",
      rule: "EXIT-5",
      steps: [{ accept: pack({ label: "after", after: { release_height: "1" } }) }],
      refused: "header signature invalid",
    },
    {
      name: "same seq twice",
      rule: "EXIT-6",
      steps: [{ accept: good }, { accept: pack({ label: "again", nonce: 2n }) }],
      refused: "is not newer than stored seq 1",
    },
    {
      name: "seq at a cancelled seq",
      rule: "EXIT-6",
      steps: [{ cancel: cancel(3n) }, { accept: pack({ label: "cancelled", seq: 3n }) }],
      refused: "seq 3 was cancelled",
    },
    {
      name: "cancel for another chain",
      rule: "EXIT-7",
      steps: [{ accept: good }, { cancel: cancel(1n, { chain: "qorechain-mainnet" }) }],
      refused: "cancel is for another chain or rollup",
    },
    {
      name: "cancel signed by another account",
      rule: "EXIT-7",
      steps: [{ accept: good }, { cancel: cancel(1n, { signer: mallory }) }],
      refused: "cancel signature invalid",
    },
    {
      name: "cancel with an unknown field",
      rule: "EXIT-7",
      steps: [{ accept: good }, { cancel: { ...cancel(1n), at: "now" } }],
      refused: "not an exit cancel v1",
    },
    {
      name: "tick before the release height",
      rule: "EXIT-8",
      steps: [{ accept: good }, tick(99, 1)],
      status: "held",
    },
    {
      name: "account nonce moved past the packet",
      rule: "EXIT-9",
      steps: [{ accept: good }, tick(100, 2)],
      status: "stale",
      reason: "account nonce is 2, packet nonce 1",
    },
    {
      name: "envelope sealed to another KEM key than the header names",
      rule: "EXIT-10",
      steps: [{ accept: pack({ label: "wrongseal", sealTo: otherTower }) }, tick(100, 1)],
      status: "rejected",
      reason: "could not open: the envelope has no entry for this key",
    },
    {
      name: "sealed transaction is a transfer",
      rule: "EXIT-10",
      steps: [{ accept: pack({ label: "transfer", transfer: true }) }, tick(100, 1)],
      status: "rejected",
      reason: "sealed transaction is not a withdrawal",
    },
    {
      name: "sealed withdrawal nonce differs from the header",
      rule: "EXIT-10",
      steps: [{ accept: pack({ label: "txnonce", txNonce: 5n }) }, tick(100, 1)],
      status: "rejected",
      reason: "withdrawal nonce differs from the header",
    },
  ],
};

const content = `${JSON.stringify(cases, null, 2)}\n`;
const path = `${ROOT}${OUT}`;
if (process.argv[2] === "--check") {
  let current: string | undefined;
  try {
    current = readFileSync(path, "utf8");
  } catch {
    current = undefined;
  }
  if (current !== content) {
    console.error(`${OUT} is stale: run node ${GENERATOR}`);
    process.exit(1);
  }
} else {
  writeFileSync(path, content);
}
