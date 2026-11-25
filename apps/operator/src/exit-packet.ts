/**
 * Build, open and cancel exit packets v1 (format in `@sdiqt/protocol`).
 * Sealing uses QoreSeal in `mlkem` mode, because the chain registry holds only
 * the tower's ML-KEM-1024 key.
 */
import { createHash } from "node:crypto";
import {
  envelopeFromText,
  envelopeToText,
  open,
  type SealKeyPair,
  seal,
} from "@qorechain/qoreseal";
import {
  decodeQledgerTx,
  encodeQledgerTx,
  type QledgerTx,
  qledgerAccountId,
  signQledgerTx,
  verifyQledgerTx,
} from "@qorechain/rdk";
import {
  EXIT_CANCEL_CONTEXT,
  EXIT_PACKET_PURPOSE,
  type ExitCancelV1,
  type ExitHeaderV1,
  ExitPacketV1,
  exitHeaderBytes,
  fromHex,
  signExitDocument,
  toHex,
} from "@sdiqt/protocol";

export interface QledgerKey {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
  accountId: Uint8Array;
}

export interface SealExitInput {
  chainId: string;
  rollupId: string;
  key: QledgerKey;
  nonce: bigint;
  amountUqor: bigint;
  /** L1 `qor1` address the withdrawal pays. */
  recipient: string;
  seq: bigint;
  releaseHeight: bigint;
  tower: string;
  towerKemPublicKey: Uint8Array;
}

export function sealExitPacket(i: SealExitInput): ExitPacketV1 {
  const tx = signQledgerTx({
    chainId: i.chainId,
    rollupId: i.rollupId,
    secretKey: i.key.secretKey,
    publicKey: i.key.publicKey,
    nonce: i.nonce,
    amount: i.amountUqor,
    recipient: i.recipient,
  });
  const header: ExitHeaderV1 = {
    v: "1",
    purpose: EXIT_PACKET_PURPOSE,
    chain_id: i.chainId,
    rollup_id: i.rollupId,
    account: toHex(i.key.accountId),
    public_key: toHex(i.key.publicKey),
    seq: i.seq.toString(),
    nonce: i.nonce.toString(),
    release_height: i.releaseHeight.toString(),
    tower: i.tower,
    tower_kem_sha256: kemKeySha256(i.towerKemPublicKey),
  };
  const envelope = seal({
    chainId: i.chainId,
    purpose: EXIT_PACKET_PURPOSE,
    recipients: [{ mlkemPublicKey: i.towerKemPublicKey }],
    plaintext: encodeQledgerTx(tx),
    aad: exitHeaderBytes(header),
    mode: "mlkem",
  });
  return ExitPacketV1.parse({
    header,
    header_sig: toHex(signExitDocument(header, i.key.secretKey)),
    envelope: envelopeToText(envelope),
  });
}

export interface OpenedExit {
  tx: QledgerTx;
  /** The payload to post to the inbox, exactly as the user signed it. */
  data: Uint8Array;
}

/**
 * Open a packet with the tower's keys and check the withdrawal inside matches
 * its header. Throws on a wrong key, a changed header or ciphertext, or a
 * withdrawal that is not the one the header names.
 */
export function openExitPacket(packet: ExitPacketV1, keys: SealKeyPair): OpenedExit {
  const h = packet.header;
  const data = open({
    chainId: h.chain_id,
    purpose: EXIT_PACKET_PURPOSE,
    envelope: envelopeFromText(packet.envelope),
    keys,
    aad: exitHeaderBytes(h),
  });
  const tx = decodeQledgerTx(data);
  if (!tx) throw new Error("sealed payload is not one qledger transaction");
  if (!verifyQledgerTx(tx, h.chain_id, h.rollup_id))
    throw new Error("withdrawal signature invalid");
  if (toHex(tx.publicKey) !== h.public_key) throw new Error("withdrawal is from another account");
  if (toHex(qledgerAccountId(tx.publicKey, tx.scheme)) !== h.account)
    throw new Error("account id does not match the key");
  if (tx.recipient === undefined) throw new Error("sealed transaction is not a withdrawal");
  if (tx.nonce.toString() !== h.nonce) throw new Error("withdrawal nonce differs from the header");
  return { tx, data };
}

export function exitCancel(i: {
  chainId: string;
  rollupId: string;
  key: QledgerKey;
  seq: bigint;
}): ExitCancelV1 {
  const body = {
    v: "1" as const,
    purpose: EXIT_CANCEL_CONTEXT,
    chain_id: i.chainId,
    rollup_id: i.rollupId,
    account: toHex(i.key.accountId),
    public_key: toHex(i.key.publicKey),
    seq: i.seq.toString(),
  };
  return { body, sig: toHex(signExitDocument(body, i.key.secretKey)) };
}

/** Whether `publicKeyHex` is the key behind `accountHex`. */
export function accountMatchesKey(accountHex: string, publicKeyHex: string): boolean {
  try {
    return toHex(qledgerAccountId(fromHex(publicKeyHex))) === accountHex;
  } catch {
    return false;
  }
}

/** Hex SHA-256 of an ML-KEM public key, as `tower_kem_sha256` carries it. */
export function kemKeySha256(publicKey: Uint8Array): string {
  return createHash("sha256").update(publicKey).digest("hex");
}
