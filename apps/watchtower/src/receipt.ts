/**
 * Receipt v1: the tower's signed statement about one batch, JCS-canonical and
 * signed with ML-DSA-87 under the context `sdiqt/receipt/v1`. Every field is
 * re-derivable from chain data plus the bundle, which is what a verifier does.
 */
import {
  ReceiptBodyV1,
  SIGNING_CONTEXTS,
  type SignedReceiptV1,
  signDocument,
  toHex,
} from "@sdiqt/protocol";

export const SOUNDNESS_NOTE =
  "Settlement is optimistic: QoreChain finalizes the batch after its challenge window unless a fraud proof is upheld. Validity is an SP1 compressed STARK over the qledger-v1 statement, checked off chain by this tower; QoreChain does not verify it.";

export function signReceipt(body: ReceiptBodyV1, secretKey: Uint8Array): SignedReceiptV1 {
  const parsed = ReceiptBodyV1.parse(body);
  return {
    body: parsed,
    signature: toHex(signDocument(parsed, secretKey, SIGNING_CONTEXTS.receiptV1)),
  };
}

/** Body fields that change the receipt's meaning; a change means a new receipt. */
export const receiptState = (b: ReceiptBodyV1) =>
  JSON.stringify([b.settlement, b.validity, b.proof?.proof_root ?? null, b.proof?.qstr_tx ?? null]);
