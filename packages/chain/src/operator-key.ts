/**
 * Connect a signing client for one QoreChain account from its mnemonic, with
 * the ML-DSA-87 key the chain has registered for it (hybrid signing).
 */
import { type RdkClient, type RdkTxClient, resolvePqcKeypair, signerFromEnv } from "@qorechain/rdk";
import { CHAIN_GAS_PRICE } from "@sdiqt/protocol";

export interface ConnectedAccount {
  address: string;
  tx: RdkTxClient;
  /** True when the chain already holds this account's ML-DSA-87 key. */
  pqcRegistered: boolean;
  pqcDerivation: string;
}

export async function connectAccount(
  client: RdkClient,
  mnemonic: string,
): Promise<ConnectedAccount> {
  const signer = await signerFromEnv({ QORE_MNEMONIC: mnemonic.trim() });
  if (!signer) throw new Error("no signer: empty mnemonic");
  const [account] = await signer.getAccounts();
  if (!account) throw new Error("signer has no account");
  const pqc = await resolvePqcKeypair(client, account.address, mnemonic.trim());
  const tx = await client.connectTx(signer, {
    gasPrice: CHAIN_GAS_PRICE,
    pqcKeypair: pqc.keypair,
    includePqcPublicKey: pqc.includePqcPublicKey,
  });
  return {
    address: account.address,
    tx,
    pqcRegistered: pqc.registered,
    pqcDerivation: pqc.derivation,
  };
}
