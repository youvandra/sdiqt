#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { sha256 } from "@noble/hashes/sha2.js";
import { resolvePqcKeypair, signerFromEnv } from "@qorechain/rdk";
import { ArchiveLagError, catchUp } from "@sdiqt/archiver";
import { createChainClient } from "@sdiqt/chain";
import type { LogEvent } from "@sdiqt/operator";
import { CHAIN_ID, fromHex, keygen, ROLLUP_ID, toHex } from "@sdiqt/protocol";
import { createApiServer } from "./api.ts";
import { bundleSource } from "./bundles.ts";
import { restChain } from "./chain-view.ts";
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
  --listen <host:port>   serve the read-only JSON API (/api/health, /api/batches, /api/receipts)`;

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

const archiveDir = join(values.archive, rollup);
const store = new TowerStore(dbFile);
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
});

log({ event: "start", issuer: signer.issuer, db: dbFile });
const api = values.listen
  ? createApiServer({
      store,
      rollupId: rollup,
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
