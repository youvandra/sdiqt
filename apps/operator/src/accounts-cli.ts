#!/usr/bin/env node
/**
 * sdiqt-accounts: account setup for the QOR gates. Without --send every
 * command only simulates. With --send it needs SDIQT_LIVE=yes and refuses any
 * spend above --cap-qor.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { ROLLUP_ID } from "@sdiqt/protocol";
import {
  balanceUqor,
  bondMessages,
  createRollupMessages,
  kemKeyHex,
  kemRegistration,
  nativeAddress,
  nativeSend,
  pqcStatus,
  readMnemonic,
  registerPqc,
  unifiedSend,
  writeNewMnemonic,
} from "./accounts.ts";

const USAGE = `sdiqt-accounts <new|show|send|register|register-kem|create-rollup|bond> [options]

  new            write a new 24-word mnemonic to --out and print its native address
  show           address, balance, ML-DSA-87 and ML-KEM-1024 status of --mnemonic-file
  send           bank send --qor to --to from the unified account in --mnemonic-file
  register       register the native account's ML-DSA-87 key (no-op when registered)
  register-kem   register the native account's QoreSeal ML-KEM-1024 key
  create-rollup  create --rollup (nft, based, qledger-v1) with --stake-qor
  bond           bond --bond-qor as submitter of --rollup

  --mnemonic-file <f>  account mnemonic
  --unified            show: derive the unified (eth_secp256k1) address
  --out <f>            new: where to write the mnemonic (refuses to overwrite)
  --to <qor1...>       send: recipient
  --qor <n>            send: whole QOR to move
  --rollup <id>        default ${ROLLUP_ID}
  --stake-qor <n>      create-rollup: default 10000
  --bond-qor <n>       bond: default 1000
  --cap-qor <n>        refuse a send whose amount plus fee is above this
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
    send: { type: "boolean", default: false },
    log: { type: "string", default: "data/accounts/gates.jsonl" },
    help: { type: "boolean", default: false },
  },
});

const COMMANDS = ["new", "show", "send", "register", "register-kem", "create-rollup", "bond"];
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
