/**
 * Account setup for the QOR gates: create native accounts, move QOR out of the
 * unified fest account, register post-quantum keys, and create the rollup.
 * Every send is simulated first and refused when the simulation fails.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { EncodeObject } from "@cosmjs/proto-signing";
import { StargateClient } from "@cosmjs/stargate";
import { deriveSealKeys } from "@qorechain/qoreseal";
import {
  bondRollupSubmitterMsg,
  createRdkRegistry,
  createRollupMsg,
  ML_KEM_1024_ALGORITHM_ID,
  registerKemKeyMsg,
  resolvePqcKeypair,
  signerFromEnv,
} from "@qorechain/rdk";
import * as sdk from "@qorechain/sdk";
import { feeForGas, parseGasPrice } from "@sdiqt/chain";
import { CHAIN_GAS_PRICE, CHAIN_ID, CHAIN_REST_URL, ROLLUP_EXECUTION_VM } from "@sdiqt/protocol";

export const CHAIN_RPC_URL = "https://rpc-testnet.qore.host";
const DENOM = "uqor";
const GAS_PRICE = parseGasPrice(CHAIN_GAS_PRICE);

export interface SendResult {
  hash: string;
  code: number;
  height?: number | undefined;
  gasUsed?: string | undefined;
  feeUqor: string;
}

export function readMnemonic(file: string): string {
  return readFileSync(file, "utf8").trim();
}

/** Write a new 24-word mnemonic to `file` (mode 0600); refuses to overwrite. */
export function writeNewMnemonic(file: string): string {
  if (existsSync(file)) throw new Error(`${file} exists: refusing to overwrite a key`);
  const mnemonic = sdk.generateMnemonic(256);
  writeFileSync(file, `${mnemonic}\n`, { mode: 0o600, flag: "wx" });
  return mnemonic;
}

/** The native (cosmos secp256k1) address the RDK signer uses for `mnemonic`. */
export async function nativeAddress(mnemonic: string): Promise<string> {
  const signer = await signerFromEnv({ QORE_MNEMONIC: mnemonic });
  if (!signer) throw new Error("no signer: empty mnemonic");
  const [account] = await signer.getAccounts();
  if (!account) throw new Error("signer has no account");
  return account.address;
}

async function getJson(path: string): Promise<unknown> {
  const r = await fetch(`${CHAIN_REST_URL}${path}`);
  if (!r.ok) throw new Error(`GET ${path}: HTTP ${r.status}`);
  return r.json();
}

export async function balanceUqor(address: string): Promise<bigint> {
  const body = (await getJson(`/cosmos/bank/v1beta1/balances/${address}`)) as {
    balances: { denom: string; amount: string }[];
  };
  return BigInt(body.balances.find((b) => b.denom === DENOM)?.amount ?? "0");
}

export async function pqcStatus(address: string): Promise<sdk.PqcStatus> {
  return sdk.fetchPqcStatus({ rest: CHAIN_REST_URL, address });
}

/** The registered ML-KEM-1024 key of `address`, hex, or undefined. */
export async function kemKeyHex(address: string): Promise<string | undefined> {
  const r = await fetch(`${CHAIN_REST_URL}/qorechain/pqc/v1/kem/${address}`);
  if (!r.ok) return undefined;
  const body = (await r.json()) as { found?: boolean; key?: { public_key?: string } };
  const key = body.found ? body.key?.public_key : undefined;
  return key ? Buffer.from(key, "base64").toString("hex") : undefined;
}

async function accountSequence(address: string) {
  const body = (await getJson(`/cosmos/auth/v1beta1/accounts/${address}`)) as {
    account: { base_account?: Record<string, string> } & Record<string, string>;
  };
  const a = body.account.base_account ?? body.account;
  return { accountNumber: BigInt(a.account_number ?? 0), sequence: BigInt(a.sequence ?? 0) };
}

async function simulateTxBytes(txBytes: Uint8Array): Promise<bigint> {
  const r = await fetch(`${CHAIN_REST_URL}/cosmos/tx/v1beta1/simulate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tx_bytes: Buffer.from(txBytes).toString("base64") }),
  });
  const body = (await r.json()) as { gas_info?: { gas_used?: string }; message?: string };
  if (!r.ok || !body.gas_info?.gas_used) {
    throw new Error(`simulation failed: ${body.message ?? `HTTP ${r.status}`}`);
  }
  return BigInt(body.gas_info.gas_used);
}

function stdFee(gas: bigint): {
  fee: { amount: { denom: string; amount: string }[]; gas: string };
  feeUqor: bigint;
  gasLimit: bigint;
} {
  const gasLimit = (gas * 130n + 99n) / 100n;
  const feeUqor = feeForGas(gas, GAS_PRICE);
  return {
    fee: { amount: [{ denom: DENOM, amount: feeUqor.toString() }], gas: gasLimit.toString() },
    feeUqor,
    gasLimit,
  };
}

/**
 * A bank send from the unified (eth_secp256k1) fest account, signed
 * eth-native with its registered ML-DSA-87 key. Simulates; broadcasts only
 * when `broadcast` is true.
 */
export async function unifiedSend(opts: {
  mnemonic: string;
  to: string;
  amountUqor: bigint;
  broadcast: boolean;
}): Promise<{ from: string; feeUqor: bigint; gas: bigint; result?: SendResult }> {
  const acc = await sdk.deriveUnifiedAccount(opts.mnemonic, 0);
  const signer = new sdk.EthNativeSigner(acc, { signMode: "hybrid", rest: CHAIN_REST_URL });
  const signBytesVersion = await signer.resolveSignBytesVersion(CHAIN_ID);
  const { accountNumber, sequence } = await accountSequence(acc.cosmos);
  const messages: EncodeObject[] = [
    {
      typeUrl: "/cosmos.bank.v1beta1.MsgSend",
      value: {
        fromAddress: acc.cosmos,
        toAddress: opts.to,
        amount: [{ denom: DENOM, amount: opts.amountUqor.toString() }],
      },
    },
  ];
  const probe = signer.sign({
    chainId: CHAIN_ID,
    accountNumber,
    sequence,
    fee: { amount: [{ denom: DENOM, amount: "0" }], gas: "2000000" },
    messages,
    signBytesVersion,
  });
  const gas = await simulateTxBytes(probe.txRawBytes);
  const { fee, feeUqor } = stdFee(gas);
  if (!opts.broadcast) return { from: acc.cosmos, feeUqor, gas };

  const transport = await StargateClient.connect(CHAIN_RPC_URL);
  try {
    const r = await signer.signAndBroadcast(transport, {
      chainId: CHAIN_ID,
      accountNumber,
      sequence,
      fee,
      messages,
      signBytesVersion,
    });
    return {
      from: acc.cosmos,
      feeUqor,
      gas,
      result: {
        hash: r.transactionHash,
        code: r.code,
        height: r.height,
        gasUsed: r.gasUsed?.toString(),
        feeUqor: feeUqor.toString(),
      },
    };
  } finally {
    transport.disconnect();
  }
}

/** The RDK registry (rollup + KEM messages) plus the SDK's QoreChain messages. */
function combinedRegistry() {
  const registry = createRdkRegistry();
  for (const [typeUrl, type] of sdk.qorechainRegistryTypes) {
    if (!registry.lookupType(typeUrl)) registry.register(typeUrl, type);
  }
  return registry;
}

/** A hybrid-signing client for a native account (cosmos secp256k1 + ML-DSA-87). */
export async function nativeClient(mnemonic: string) {
  const signer = await signerFromEnv({ QORE_MNEMONIC: mnemonic });
  if (!signer) throw new Error("no signer: empty mnemonic");
  const [account] = await signer.getAccounts();
  if (!account) throw new Error("signer has no account");
  const rdk = (await import("@sdiqt/chain")).createChainClient();
  const pqc = await resolvePqcKeypair(rdk, account.address, mnemonic);
  const tx = await sdk.TxClient.connect({
    rpcEndpoint: CHAIN_RPC_URL,
    signer,
    gasPrice: CHAIN_GAS_PRICE,
    pqcKeypair: pqc.keypair,
    rest: CHAIN_REST_URL,
    registry: combinedRegistry(),
  } as sdk.TxConnectOptions);
  return { address: account.address, tx, pqc };
}

/** Register the account's ML-DSA-87 key when the chain has none (idempotent). */
export async function registerPqc(mnemonic: string, broadcast: boolean) {
  const { address, tx, pqc } = await nativeClient(mnemonic);
  try {
    if (pqc.registered) return { address, alreadyRegistered: true as const };
    if (!broadcast)
      return { address, alreadyRegistered: false as const, derivation: pqc.derivation };
    const r = await sdk.ensurePqcRegistered(tx, { pqcKeypair: pqc.keypair, rest: CHAIN_REST_URL });
    return { address, alreadyRegistered: false as const, result: r };
  } finally {
    tx.disconnect();
  }
}

/** Simulate, then (when `broadcast`) send `messages` from a native account. */
export async function nativeSend(
  mnemonic: string,
  messages: (address: string) => EncodeObject[],
  broadcast: boolean,
): Promise<{ address: string; gas: bigint; feeUqor: bigint; result?: SendResult }> {
  const { address, tx, pqc } = await nativeClient(mnemonic);
  try {
    if (!pqc.registered)
      throw new Error(`${address} has no registered ML-DSA-87 key: run register first`);
    const msgs = messages(address);
    const gas = BigInt(await tx.simulate(msgs));
    const { fee, feeUqor } = stdFee(gas);
    if (!broadcast) return { address, gas, feeUqor };
    const r = await tx.signAndBroadcast(msgs, fee);
    return {
      address,
      gas,
      feeUqor,
      result: {
        hash: r.transactionHash,
        code: r.code,
        height: r.height,
        gasUsed: r.gasUsed?.toString(),
        feeUqor: feeUqor.toString(),
      },
    };
  } finally {
    tx.disconnect();
  }
}

/** The ML-KEM-1024 registration message for a mnemonic's QoreSeal key. */
export function kemRegistration(mnemonic: string) {
  const keys = deriveSealKeys({ mnemonic, index: 0 });
  return {
    publicKeyHex: Buffer.from(keys.mlkemPublicKey).toString("hex"),
    message: (sender: string) =>
      registerKemKeyMsg({
        sender,
        publicKey: keys.mlkemPublicKey,
        algorithmId: ML_KEM_1024_ALGORITHM_ID,
      }),
  };
}

export function createRollupMessages(rollupId: string, stakeUqor: bigint) {
  return (creator: string) => [
    createRollupMsg({
      creator,
      rollupId,
      profile: "nft",
      vmType: "cosmwasm",
      stakeAmount: stakeUqor.toString(),
      sequencing: "based",
      executionVm: ROLLUP_EXECUTION_VM,
    }),
  ];
}

export function bondMessages(rollupId: string, amountUqor: bigint) {
  return (submitter: string) => [
    bondRollupSubmitterMsg({ submitter, rollupId, amount: amountUqor.toString() }),
  ];
}
