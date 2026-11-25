#!/usr/bin/env node
/**
 * sdiqt-accounts: account setup for the QOR gates. Without --send every
 * command only simulates. With --send it needs SDIQT_LIVE=yes and refuses any
 * spend above --cap-qor.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { executeWithdrawalMsg } from "@qorechain/rdk";
import { readArchive } from "@sdiqt/archiver";
import { CHAIN_ID, ROLLUP_ID } from "@sdiqt/protocol";
import {
  balanceUqor,
  bondMessages,
  createRollupMessages,
  depositMessages,
  kemKeyHex,
  kemRegistration,
  l2TxMessages,
  nativeAddress,
  nativeSend,
  pqcStatus,
  readL2Key,
  readMnemonic,
  registerPqc,
  unifiedSend,
  writeNewL2Seed,
  writeNewMnemonic,
} from "./accounts.ts";
import { exitCancel, sealExitPacket } from "./exit-packet.ts";
import { withdrawalClaims } from "./withdraw.ts";

const USAGE = `sdiqt-accounts <new|show|send|register|register-kem|create-rollup|bond> [options]

  new            write a new 24-word mnemonic to --out and print its native address
  show           address, balance, ML-DSA-87 and ML-KEM-1024 status of --mnemonic-file
  send           bank send --qor to --to from the unified account in --mnemonic-file
  register       register the native account's ML-DSA-87 key (no-op when registered)
  register-kem   register the native account's QoreSeal ML-KEM-1024 key
  create-rollup  create --rollup (nft, based, qledger-v1) with --stake-qor
  bond           bond --bond-qor as submitter of --rollup
  l2-new         write a new qledger ML-DSA-44 seed to --out and print its account id
  deposit        deposit --uqor from --mnemonic-file into the L2 account of --l2-key
  l2-send        post a qledger tx signed by --l2-key: --to-key (transfer) or
                 --recipient (withdrawal), --uqor, --nonce; posted by --mnemonic-file
  seal-exit      seal a withdrawal (--l2-key, --recipient, --uqor, --nonce) to --tower's
                 registered ML-KEM-1024 key as exit packet --seq, released at
                 --release-height; writes --out, and with --send delivers it to --tower-url
  withdraw-exec  execute the withdrawal to --recipient in anchored batch --batch (FINAL),
                 proof rebuilt from --archive; sent by --mnemonic-file
  cancel-exit    sign a cancel of every exit packet of --l2-key up to --seq; writes --out,
                 and with --send delivers it to --tower-url

  --mnemonic-file <f>  account mnemonic
  --unified            show: derive the unified (eth_secp256k1) address
  --out <f>            new: where to write the mnemonic (refuses to overwrite)
  --to <qor1...>       send: recipient
  --qor <n>            send: whole QOR to move
  --rollup <id>        default ${ROLLUP_ID}
  --stake-qor <n>      create-rollup: default 10000
  --bond-qor <n>       bond: default 1000
  --cap-qor <n>        refuse a send whose amount plus fee is above this
  --l2-key <f>         qledger seed file (the sender, or the deposit target)
  --to-key <f>         l2-send: qledger seed file of the recipient account
  --recipient <qor1>   l2-send: withdraw to this L1 address
  --uqor <n>           deposit / l2-send amount in uqor
  --nonce <n>          l2-send / seal-exit: sender's next nonce (first is 0)
  --seq <n>            seal-exit / cancel-exit: packet sequence (higher replaces lower)
  --release-height <n> seal-exit: first height at which the tower may post
  --tower <qor1>       seal-exit: tower account whose KEM key the packet is sealed to
  --tower-url <url>    tower base URL, e.g. https://sdiqt.xyz
  --batch <n>          withdraw-exec: batch index holding the withdrawal
  --archive <dir>      withdraw-exec: archive root, default data/archive
  --send               broadcast (needs SDIQT_LIVE=yes); without it, simulate only
  --log <f>            JSONL log, default data/accounts/gates.jsonl`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    "mnemonic-file": { type: "string" },
    unified: { type: "boolean", default: false },
    out: { type: "string" },
    to: { type: "string" },
    qor: { type: "string" },
    rollup: { type: "string", default: ROLLUP_ID },
    "stake-qor": { type: "string", default: "10000" },
    "bond-qor": { type: "string", default: "1000" },
    "cap-qor": { type: "string" },
    "l2-key": { type: "string" },
    "to-key": { type: "string" },
    recipient: { type: "string" },
    uqor: { type: "string" },
    nonce: { type: "string" },
    seq: { type: "string" },
    "release-height": { type: "string" },
    tower: { type: "string" },
    "tower-url": { type: "string" },
    batch: { type: "string" },
    archive: { type: "string", default: "data/archive" },
    send: { type: "boolean", default: false },
    log: { type: "string", default: "data/accounts/gates.jsonl" },
    help: { type: "boolean", default: false },
  },
});

const COMMANDS = [
  "new",
  "show",
  "send",
  "register",
  "register-kem",
  "create-rollup",
  "bond",
  "l2-new",
  "deposit",
  "l2-send",
  "seal-exit",
  "cancel-exit",
  "withdraw-exec",
];
const mode = positionals[0] ?? "";
if (values.help || !COMMANDS.includes(mode)) {
  console.log(USAGE);
  process.exit(values.help ? 0 : 2);
}

const UQOR = 1_000_000n;
const qor = (uqor: bigint) => `${uqor / UQOR}.${(uqor % UQOR).toString().padStart(6, "0")}`;

mkdirSync(dirname(values.log), { recursive: true });
function log(e: Record<string, unknown>) {
  const line = JSON.stringify({ at: new Date().toISOString(), command: mode, ...e }, (_k, v) =>
    typeof v === "bigint" ? v.toString() : v,
  );
  if (values.send) appendFileSync(values.log, `${line}\n`);
  console.log(line);
}

function mnemonicFile(): string {
  const f = values["mnemonic-file"];
  if (!f) throw new Error(`${mode} needs --mnemonic-file`);
  return f;
}

function wholeQor(name: string, raw: string | undefined): bigint {
  if (!raw || !/^[0-9]+$/.test(raw)) throw new Error(`${name} must be whole QOR`);
  return BigInt(raw) * UQOR;
}

/** Live sends need the env switch, a cap that covers them, and a typed yes. */
async function confirmSend(label: string, spendUqor: bigint): Promise<void> {
  if (process.env.SDIQT_LIVE !== "yes") throw new Error("--send needs SDIQT_LIVE=yes");
  const cap = wholeQor("--cap-qor", values["cap-qor"]);
  if (spendUqor > cap) {
    throw new Error(`${label}: ${qor(spendUqor)} QOR is above --cap-qor ${qor(cap)}`);
  }
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`${label}: spend up to ${qor(spendUqor)} QOR. Type "send": `);
    rl.close();
    if (answer.trim() !== "send") throw new Error("not confirmed");
  }
}

function checkResult(r: { code: number; hash: string } | undefined) {
  if (r && r.code !== 0) throw new Error(`tx ${r.hash} failed with code ${r.code}`);
}

if (mode === "new") {
  if (!values.out) throw new Error("new needs --out");
  const mnemonic = writeNewMnemonic(values.out);
  log({ file: values.out, native: await nativeAddress(mnemonic) });
  process.exit(0);
}

if (mode === "l2-new") {
  if (!values.out) throw new Error("l2-new needs --out");
  writeNewL2Seed(values.out);
  log({
    file: values.out,
    account_id: Buffer.from(readL2Key(values.out).accountId).toString("hex"),
  });
  process.exit(0);
}

function uqorArg(): bigint {
  const raw = values.uqor;
  if (!raw || !/^[0-9]+$/.test(raw) || raw === "0")
    throw new Error("--uqor must be a positive integer");
  return BigInt(raw);
}

function l2Key(name: "l2-key" | "to-key") {
  const f = values[name];
  if (!f) throw new Error(`${mode} needs --${name}`);
  return readL2Key(f);
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function decimalArg(name: string): bigint {
  const raw = values[name as keyof typeof values];
  if (typeof raw !== "string" || !/^[0-9]+$/.test(raw)) throw new Error(`${mode} needs --${name}`);
  return BigInt(raw);
}

/** Write `doc` to --out (refuses to overwrite) and, with --send, POST it to the tower. */
async function deliverExit(doc: unknown, path: string): Promise<void> {
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  if (values.out) writeFileSync(values.out, text, { flag: "wx" });
  if (!values.send) {
    log({ stage: "written", out: values.out ?? null, bytes: text.length });
    return;
  }
  const base = values["tower-url"];
  if (!base) throw new Error("--send needs --tower-url");
  const r = await fetch(new URL(path, base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: text,
  });
  log({ stage: "delivered", status: r.status, tower: await r.json() });
  if (!r.ok) process.exit(1);
}

if (mode === "seal-exit") {
  const tower = values.tower;
  if (!tower || !values.recipient) throw new Error("seal-exit needs --tower and --recipient");
  const kem = await kemKeyHex(tower);
  if (!kem) throw new Error(`${tower} has no registered ML-KEM-1024 key`);
  const key = l2Key("l2-key");
  const packet = sealExitPacket({
    chainId: CHAIN_ID,
    rollupId: values.rollup,
    key,
    nonce: decimalArg("nonce"),
    amountUqor: uqorArg(),
    recipient: values.recipient,
    seq: decimalArg("seq"),
    releaseHeight: decimalArg("release-height"),
    tower,
    towerKemPublicKey: Buffer.from(kem, "hex"),
  });
  console.log(JSON.stringify({ header: packet.header, envelope_chars: packet.envelope.length }));
  await deliverExit(packet, "/api/exits");
  process.exit(0);
}

if (mode === "cancel-exit") {
  const cancel = exitCancel({
    chainId: CHAIN_ID,
    rollupId: values.rollup,
    key: l2Key("l2-key"),
    seq: decimalArg("seq"),
  });
  console.log(JSON.stringify(cancel.body));
  await deliverExit(cancel, "/api/exits/cancel");
  process.exit(0);
}

const mnemonic = readMnemonic(mnemonicFile());

if (mode === "show") {
  const address = values.unified
    ? (await import("@qorechain/sdk")).deriveUnifiedAccount(mnemonic, 0).then((a) => a.cosmos)
    : nativeAddress(mnemonic);
  const a = await address;
  const [bal, pqc, kem] = await Promise.all([balanceUqor(a), pqcStatus(a), kemKeyHex(a)]);
  log({
    address: a,
    balance_qor: qor(bal),
    pqc_registered: pqc.registered,
    pqc_algorithm: pqc.algorithmId,
    kem_registered: kem !== undefined,
    kem_key_prefix: kem?.slice(0, 16),
  });
  process.exit(0);
}

if (mode === "send") {
  if (!values.to) throw new Error("send needs --to");
  const amount = wholeQor("--qor", values.qor);
  const sim = await unifiedSend({ mnemonic, to: values.to, amountUqor: amount, broadcast: false });
  log({
    stage: "simulated",
    from: sim.from,
    to: values.to,
    amount_qor: qor(amount),
    gas: sim.gas,
    fee_qor: qor(sim.feeUqor),
  });
  if (values.send) {
    await confirmSend(`send ${qor(amount)} QOR to ${values.to}`, amount + sim.feeUqor);
    const r = await unifiedSend({ mnemonic, to: values.to, amountUqor: amount, broadcast: true });
    log({ stage: "sent", from: r.from, to: values.to, amount_qor: qor(amount), ...r.result });
    checkResult(r.result);
  }
  process.exit(0);
}

if (mode === "register") {
  const sim = await registerPqc(mnemonic, false);
  log({ stage: "checked", ...sim });
  if (values.send && !sim.alreadyRegistered) {
    await confirmSend(`register ML-DSA-87 for ${sim.address}`, UQOR);
    const r = await registerPqc(mnemonic, true);
    const tx = "result" in r ? r.result?.result : undefined;
    log({
      stage: "sent",
      address: r.address,
      hash: tx?.transactionHash,
      code: tx?.code,
      height: tx?.height,
      gasUsed: tx?.gasUsed,
    });
    checkResult(tx ? { code: tx.code, hash: tx.transactionHash } : undefined);
  }
  process.exit(0);
}

const runNative = async (
  label: string,
  messages: Parameters<typeof nativeSend>[1],
  amountUqor: bigint,
) => {
  const sim = await nativeSend(mnemonic, messages, false);
  log({
    stage: "simulated",
    address: sim.address,
    gas: sim.gas,
    fee_qor: qor(sim.feeUqor),
    amount_qor: qor(amountUqor),
  });
  if (!values.send) return;
  await confirmSend(label, amountUqor + sim.feeUqor);
  const r = await nativeSend(mnemonic, messages, true);
  log({ stage: "sent", address: r.address, ...r.result });
  checkResult(r.result);
};

if (mode === "register-kem") {
  const kem = kemRegistration(mnemonic);
  const address = await nativeAddress(mnemonic);
  const existing = await kemKeyHex(address);
  if (existing === kem.publicKeyHex) {
    log({ stage: "checked", address, kem_registered: true });
    process.exit(0);
  }
  if (existing) throw new Error(`${address} holds a different ML-KEM key`);
  await runNative(`register ML-KEM-1024 for ${address}`, (s) => [kem.message(s)], 0n);
  process.exit(0);
}

if (mode === "create-rollup") {
  const stake = wholeQor("--stake-qor", values["stake-qor"]);
  // The layer registration locks a further 1,000 QOR from the creator.
  const layer = 1_000n * UQOR;
  await runNative(
    `create rollup ${values.rollup}`,
    createRollupMessages(values.rollup, stake),
    stake + layer,
  );
  process.exit(0);
}

if (mode === "bond") {
  const amount = wholeQor("--bond-qor", values["bond-qor"]);
  await runNative(`bond ${values.rollup}`, bondMessages(values.rollup, amount), amount);
  process.exit(0);
}

if (mode === "deposit") {
  const amount = uqorArg();
  const key = l2Key("l2-key");
  console.log(JSON.stringify({ l2_account: hex(key.accountId) }));
  await runNative(
    `deposit ${qor(amount)} QOR into ${values.rollup}`,
    depositMessages(values.rollup, key.accountId, amount),
    amount,
  );
  process.exit(0);
}

if (mode === "withdraw-exec") {
  if (!values.recipient) throw new Error("withdraw-exec needs --recipient");
  const batchIndex = decimalArg("batch").toString();
  const { entries, batches } = await readArchive(join(values.archive, values.rollup));
  const batch = batches
    .filter((b) => b.batch_index === batchIndex)
    .sort((a, b) => Number(BigInt(b.height) - BigInt(a.height)))[0];
  if (!batch) throw new Error(`no archived batch ${batchIndex} on ${values.rollup}`);
  const claims = withdrawalClaims({ chainId: CHAIN_ID, rollupId: values.rollup, entries, batch });
  const claim = claims.find((c) => c.recipient === values.recipient);
  if (!claim) throw new Error(`batch ${batchIndex} has no withdrawal to ${values.recipient}`);
  log({
    stage: "claim",
    batch_index: batchIndex,
    batch_tx: batch.txhash,
    withdrawal_index: claim.index,
    amount_qor: qor(claim.amount),
    proof_len: claim.proof.length,
  });
  await runNative(
    `execute withdrawal ${claim.index} of batch ${batchIndex}`,
    (submitter) => [
      executeWithdrawalMsg({
        submitter,
        rollupId: values.rollup,
        batchIndex: BigInt(batchIndex),
        withdrawalIndex: claim.index,
        recipient: claim.recipient,
        denom: "uqor",
        amount: claim.amount.toString(),
        proof: claim.proof,
      }),
    ],
    0n,
  );
  process.exit(0);
}

if (mode === "l2-send") {
  const amount = uqorArg();
  if (!values.nonce || !/^[0-9]+$/.test(values.nonce)) throw new Error("l2-send needs --nonce");
  if (Boolean(values["to-key"]) === Boolean(values.recipient)) {
    throw new Error("l2-send needs exactly one of --to-key or --recipient");
  }
  const key = l2Key("l2-key");
  const to = values["to-key"] ? l2Key("to-key").accountId : undefined;
  const post = l2TxMessages({
    rollupId: values.rollup,
    key,
    nonce: BigInt(values.nonce),
    amountUqor: amount,
    ...(to ? { to } : {}),
    ...(values.recipient ? { recipient: values.recipient } : {}),
  });
  console.log(
    JSON.stringify({
      from: hex(key.accountId),
      ...(to ? { to: hex(to) } : { recipient: values.recipient }),
      nonce: values.nonce,
      amount_uqor: amount.toString(),
      bytes: post.bytes,
    }),
  );
  // Posted-data fee is per byte on top of gas; the simulation covers it.
  await runNative(`post qledger tx to ${values.rollup}`, post.messages, 0n);
  process.exit(0);
}
