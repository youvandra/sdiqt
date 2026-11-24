#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { connectAccount, createChainClient, parseGasPrice, SafeTx, SpendCap } from "@sdiqt/chain";
import { BundleManifestV1, CHAIN_GAS_PRICE, CHAIN_ID, ROLLUP_ID } from "@sdiqt/protocol";
import { type LogEvent, Operator, type Submitter } from "./operator.ts";
import { postedDataFeeUqor, postQstr, prepareQstr } from "./qstr.ts";
import { ProcessRustClaimer } from "./rust-claimer.ts";
import { liveSubmitter } from "./submit.ts";

const USAGE = `sdiqt-operator <shadow|history|live|qstr> [options]

  shadow   watch a rollup, check every new chain batch, log what it would submit
  history  check every archived batch of a rollup against the replay, then exit
  live     submit batches (needs SDIQT_LIVE=yes and --mnemonic-file)
  qstr     print the QSTR of --bundle; with --post, post it (SDIQT_LIVE=yes)

  --rollup <id>          default ${ROLLUP_ID}
  --archive <dir>        default data/archive
  --prover <path>        sdiqt-prove binary, default target/release/sdiqt-prove
  --interval <s>         seconds between ticks, default 15
  --heartbeat <s>        log a heartbeat this often, default 600 (0 = off)
  --duration <s>         stop after this long (shadow), default forever
  --log <file>           JSONL log, default data/operator/<rollup>.jsonl
  --control <file>       run | pause | drain, default data/operator/control
  --mnemonic-file <f>    live only: the operator account mnemonic
  --cap-qor <n>          live only: daily spend cap, default 50
  --bundle <dir>         qstr: proof bundle directory holding manifest.json
  --prover-id <id>       qstr: prover label, default sdiqt-mac-1
  --post                 qstr: post the commitment to --rollup`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    rollup: { type: "string", default: ROLLUP_ID },
    archive: { type: "string", default: "data/archive" },
    prover: { type: "string", default: "target/release/sdiqt-prove" },
    interval: { type: "string", default: "15" },
    heartbeat: { type: "string", default: "600" },
    duration: { type: "string" },
    log: { type: "string" },
    control: { type: "string", default: "data/operator/control" },
    "mnemonic-file": { type: "string" },
    "cap-qor": { type: "string", default: "50" },
    bundle: { type: "string" },
    "prover-id": { type: "string", default: "sdiqt-mac-1" },
    post: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

const mode = positionals[0];
if (values.help || !["shadow", "history", "live", "qstr"].includes(mode ?? "")) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}

const logFile = values.log ?? join("data/operator", `${values.rollup}.jsonl`);
mkdirSync(dirname(logFile), { recursive: true });
const log = (e: LogEvent) => {
  const line = JSON.stringify({ at: new Date().toISOString(), rollup: values.rollup, ...e });
  appendFileSync(logFile, `${line}\n`);
  console.log(line);
};

const client = createChainClient();

async function liveAccount() {
  if (process.env.SDIQT_LIVE !== "yes") throw new Error(`${mode} needs SDIQT_LIVE=yes`);
  const file = values["mnemonic-file"];
  if (!file) throw new Error(`${mode} needs --mnemonic-file`);
  const account = await connectAccount(client, readFileSync(file, "utf8"));
  if (!account.pqcRegistered) throw new Error(`${account.address} has no registered ML-DSA-87 key`);
  const cap = new SpendCap(BigInt(values["cap-qor"]) * 1_000_000n);
  return { account, safe: new SafeTx(account.tx, { ...parseGasPrice(CHAIN_GAS_PRICE), cap }) };
}

if (mode === "qstr") {
  if (!values.bundle) throw new Error("qstr needs --bundle <dir>");
  const manifest = BundleManifestV1.parse(
    JSON.parse(readFileSync(join(values.bundle, "manifest.json"), "utf8")),
  );
  const proverId = values["prover-id"];
  const { qstr, bytes, dataHash } = prepareQstr(manifest, proverId);
  const feePerByte = BigInt((await client.rest.getParams()).postedDataFeePerByte ?? 0);
  log({
    event: "qstr",
    batch_index: qstr.batchIndex,
    bytes: bytes.length,
    data_hash: dataHash,
    manifest_sha256: qstr.manifestSha256,
    data_fee_uqor: postedDataFeeUqor(bytes.length, feePerByte).toString(),
  });
  if (values.post) {
    const { account, safe } = await liveAccount();
    const r = await postQstr(
      { tx: account.tx, safe, rollupId: values.rollup, feePerByte },
      manifest,
      proverId,
    );
    log({ event: "qstr_posted", batch_index: qstr.batchIndex, ...r });
  }
  process.exit(0);
}

const rust = new ProcessRustClaimer(values.prover);
let operator: string | undefined;
let submit: Submitter | undefined;

if (mode === "live") {
  const { account, safe } = await liveAccount();
  submit = liveSubmitter(account.tx, safe);
  operator = account.address;
}

const op = new Operator({
  client,
  chainId: CHAIN_ID,
  rollupId: values.rollup,
  archiveDir: join(values.archive, values.rollup),
  rust,
  mode: mode === "live" ? "live" : "shadow",
  ...(operator ? { operator } : {}),
  ...(submit ? { submit } : {}),
  controlFile: values.control,
  heartbeatTicks: Math.round(Number(values.heartbeat) / Number(values.interval)),
  log,
});

if (mode === "history") {
  const r = await op.verifyHistory();
  log({
    event: "history",
    batches: r.batches,
    matched: r.matched,
    differing: r.differing.map((b) => b.txhash),
  });
  rust.close();
  process.exit(0);
}

const intervalMs = Number(values.interval) * 1000;
const stopAt = values.duration
  ? Date.now() + Number(values.duration) * 1000
  : Number.POSITIVE_INFINITY;
while (Date.now() < stopAt) {
  try {
    await op.tick();
  } catch (err) {
    log({ event: "error", alert: true, error: String(err) });
  }
  await new Promise((r) => setTimeout(r, intervalMs));
}
log({ event: "stop", ...op.stats });
rust.close();
