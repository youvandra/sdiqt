#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { sha256 } from "@noble/hashes/sha2.js";
import { deriveSealKeys } from "@qorechain/qoreseal";
import {
  DEFAULT_CHALLENGE_BOND_UQOR,
  postRollupDataMsg,
  resolvePqcKeypair,
  signerFromEnv,
} from "@qorechain/rdk";
import { ArchiveLagError, catchUp } from "@sdiqt/archiver";
import { connectAccount, createChainClient, parseGasPrice, SafeTx, SpendCap } from "@sdiqt/chain";
import type { LogEvent } from "@sdiqt/operator";
import { postedDataFeeUqor } from "@sdiqt/operator";
import {
  CHAIN_GAS_PRICE,
  CHAIN_ID,
  CHAIN_REST_URL,
  fromHex,
  keygen,
  ROLLUP_ID,
  toHex,
} from "@sdiqt/protocol";
import { createApiServer } from "./api.ts";
import { bundleSource } from "./bundles.ts";
import { restChain } from "./chain-view.ts";
import { type Challenger, liveChallenger } from "./challenge.ts";
import { ExitDesk } from "./exits.ts";
import { TowerStore } from "./store.ts";
import { Tower } from "./tower.ts";

const USAGE = `sdiqt-watchtower --operator <qor1...> --bundles <url|dir> (--mnemonic-file <f> | --dev-seed <hex>) [options]

  --rollup <id>          default ${ROLLUP_ID}
  --archive <dir>        default data/archive
  --db <file>            default data/watchtower/<rollup>.sqlite
  --operator <addr>      address whose QSTR posts name our bundles
  --bundles <url|dir>    where verified bundles live (https://.../bundles or a directory)
  --vkey-hash <hex>      pin the SP1 program
  --mnemonic-file <f>    the tower account (its registered ML-DSA-87 key signs receipts)
  --dev-seed <hex>       32-byte seed for a local test key instead (issuer marked dev:)
  --interval <s>         default 30
  --duration <s>         stop after this long, default forever
  --log <file>           JSONL log, default data/watchtower/<rollup>.jsonl
  --challenge            send challenges for confirmed fraud (needs SDIQT_LIVE=yes and
                         --mnemonic-file; posts the rollup's challenge bond)
  --cap-qor <n>          challenge only: daily spend cap incl. bond, default 1050
  --listen <host:port>   serve the JSON API (/api/health, /api/batches, /api/receipts, /api/exits)
  --exits                accept exit packets v1 sealed to the tower's registered ML-KEM-1024
                         key (needs --mnemonic-file); due packets are opened but held
  --exits-post           also post due withdrawals to the inbox (needs SDIQT_LIVE=yes)
  --exit-cap-qor <n>     exit posts only: daily spend cap, default 2`;

const { values } = parseArgs({
  options: {
    rollup: { type: "string", default: ROLLUP_ID },
    archive: { type: "string", default: "data/archive" },
    db: { type: "string" },
    operator: { type: "string" },
    bundles: { type: "string" },
    "vkey-hash": { type: "string" },
    "mnemonic-file": { type: "string" },
    "dev-seed": { type: "string" },
    interval: { type: "string", default: "30" },
    duration: { type: "string" },
    log: { type: "string" },
    listen: { type: "string" },
    challenge: { type: "boolean", default: false },
    "cap-qor": { type: "string", default: "1050" },
    exits: { type: "boolean", default: false },
    "exits-post": { type: "boolean", default: false },
    "exit-cap-qor": { type: "string", default: "2" },
    help: { type: "boolean", default: false },
  },
});
if (values.help || !values.operator || !values.bundles) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}

const rollup = values.rollup;
const logFile = values.log ?? join("data/watchtower", `${rollup}.jsonl`);
const dbFile = values.db ?? join("data/watchtower", `${rollup}.sqlite`);
mkdirSync(dirname(logFile), { recursive: true });
mkdirSync(dirname(dbFile), { recursive: true });
const log = (e: LogEvent) => {
  const line = JSON.stringify({ at: new Date().toISOString(), rollup, ...e });
  appendFileSync(logFile, `${line}\n`);
  console.log(line);
};

const client = createChainClient();
let signer: { issuer: string; secretKey: Uint8Array };
if (values["mnemonic-file"]) {
  const mnemonic = readFileSync(values["mnemonic-file"], "utf8").trim();
  const s = await signerFromEnv({ QORE_MNEMONIC: mnemonic });
  const [acct] = (await s?.getAccounts()) ?? [];
  if (!acct) throw new Error("no account in the mnemonic");
  const pqc = await resolvePqcKeypair(client, acct.address, mnemonic);
  if (!pqc.registered) throw new Error(`${acct.address} has no registered ML-DSA-87 key`);
  signer = { issuer: acct.address, secretKey: pqc.keypair.secretKey };
} else if (values["dev-seed"]) {
  const keys = keygen(fromHex(values["dev-seed"]));
  signer = {
    issuer: `dev:${toHex(sha256(keys.publicKey)).slice(0, 16)}`,
    secretKey: keys.secretKey,
  };
} else {
  throw new Error("pass --mnemonic-file or --dev-seed");
}

/** Fee room kept beside the bond when checking the cap: 1 QOR. */
const CHALLENGE_FEE_HEADROOM_UQOR = 1_000_000n;
let challenger: Challenger | undefined;
if (values.challenge) {
  if (process.env.SDIQT_LIVE !== "yes") throw new Error("--challenge needs SDIQT_LIVE=yes");
  const file = values["mnemonic-file"];
  if (!file) throw new Error("--challenge needs --mnemonic-file");
  const account = await connectAccount(client, readFileSync(file, "utf8"));
  if (!account.pqcRegistered) throw new Error(`${account.address} has no registered ML-DSA-87 key`);
  const cap = new SpendCap(BigInt(values["cap-qor"]) * 1_000_000n);
  const safe = new SafeTx(account.tx, { ...parseGasPrice(CHAIN_GAS_PRICE), cap });
  const bond = BigInt(
    (await client.rest.getRollup(rollup)).challengeBond ?? DEFAULT_CHALLENGE_BOND_UQOR,
  );
  // Fail now rather than at the first fraud: the bond plus a fee must fit the cap.
  const needed = bond + CHALLENGE_FEE_HEADROOM_UQOR;
  if (needed > BigInt(values["cap-qor"]) * 1_000_000n) {
    throw new Error(
      `challenge bond ${bond} uqor plus fee headroom does not fit --cap-qor ${values["cap-qor"]}`,
    );
  }
  challenger = liveChallenger(account.tx, safe, rollup, bond);
}

const archiveDir = join(values.archive, rollup);
const store = new TowerStore(dbFile);
let exits: ExitDesk | undefined;
if (values.exits || values["exits-post"]) {
  const file = values["mnemonic-file"];
  if (!file) throw new Error("--exits needs --mnemonic-file");
  const mnemonic = readFileSync(file, "utf8").trim();
  const kemKeys = deriveSealKeys({ mnemonic, index: 0 });
  // Packets are sealed to the key the chain registry names; refuse to run with another one.
  const r = await fetch(`${CHAIN_REST_URL}/qorechain/pqc/v1/kem/${signer.issuer}`);
  const body = (await r.json()) as { found?: boolean; key?: { public_key?: string } };
  const registered =
    body.found && body.key?.public_key
      ? Buffer.from(body.key.public_key, "base64").toString("hex")
      : undefined;
  if (registered !== toHex(kemKeys.mlkemPublicKey))
    throw new Error(`${signer.issuer}: registered ML-KEM key differs from the mnemonic's key`);
  let post: ConstructorParameters<typeof ExitDesk>[0]["post"];
  if (values["exits-post"]) {
    if (process.env.SDIQT_LIVE !== "yes") throw new Error("--exits-post needs SDIQT_LIVE=yes");
    const account = await connectAccount(client, mnemonic);
    const cap = new SpendCap(BigInt(values["exit-cap-qor"]) * 1_000_000n);
    const safe = new SafeTx(account.tx, { ...parseGasPrice(CHAIN_GAS_PRICE), cap });
    const feePerByte = BigInt((await client.rest.getParams()).postedDataFeePerByte ?? 0);
    post = async (data, label) => {
      const { tx } = await safe.run({
        label,
        messages: [postRollupDataMsg({ poster: account.address, rollupId: rollup, data })],
        amountUqor: postedDataFeeUqor(data.length, feePerByte),
        send: () => account.tx.postRollupData({ rollupId: rollup, data }),
      });
      return { txhash: tx.transactionHash };
    };
  }
  exits = new ExitDesk({
    db: store.db,
    chainId: CHAIN_ID,
    rollupId: rollup,
    tower: signer.issuer,
    kemKeys,
    ...(post ? { post } : {}),
    log,
  });
}

const tower = new Tower({
  chainId: CHAIN_ID,
  rollupId: rollup,
  archiveDir,
  chain: restChain(client),
  store,
  bundles: bundleSource(values.bundles),
  operator: values.operator,
  ...(values["vkey-hash"] ? { vkeyHash: values["vkey-hash"] } : {}),
  signer,
  refreshArchive: async () => {
    try {
      await catchUp({ client, chainId: CHAIN_ID, rollupId: rollup, dir: archiveDir });
    } catch (err) {
      if (!(err instanceof ArchiveLagError)) throw err;
    }
  },
  log,
  ...(challenger ? { challenger } : {}),
  ...(exits ? { exits } : {}),
});

log({
  event: "start",
  issuer: signer.issuer,
  db: dbFile,
  challenge: challenger !== undefined,
  exits: exits ? (values["exits-post"] ? "post" : "hold") : "off",
});
const api = values.listen
  ? createApiServer({
      store,
      rollupId: rollup,
      ...(exits ? { exits } : {}),
      onError: (err) => log({ event: "api_error", alert: true, error: String(err) }),
    })
  : undefined;
if (api && values.listen) {
  const at = values.listen.lastIndexOf(":");
  const host = at > 0 ? values.listen.slice(0, at) : "127.0.0.1";
  const port = Number(values.listen.slice(at + 1));
  await new Promise<void>((r) => api.listen(port, host, r));
  log({ event: "api_listening", host, port });
}
const stopAt = values.duration
  ? Date.now() + Number(values.duration) * 1000
  : Number.POSITIVE_INFINITY;
while (Date.now() < stopAt) {
  try {
    const r = await tower.tick();
    log({ event: "tick", ...r });
  } catch (err) {
    log({ event: "error", alert: true, error: String(err) });
  }
  await new Promise((r) => setTimeout(r, Number(values.interval) * 1000));
}
await new Promise<void>((r) => (api ? api.close(() => r()) : r()));
store.close();
log({ event: "stop" });
