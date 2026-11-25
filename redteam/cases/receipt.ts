/**
 * Case 5: forged receipt signatures. The fixture is the live receipt for
 * `sdiqt-1` batch 3 (GET https://sdiqt.xyz/api/receipts/3) and the ML-DSA-87
 * key the chain registered for its issuer. Checks go through `verifyDocument`
 * from `@sdiqt/protocol`, the same function the tower signs with in reverse.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  fromHex,
  keygen,
  ReceiptBodyV1,
  SIGNING_CONTEXTS,
  type SignedReceiptV1,
  type SigningContext,
  signDocument,
  toHex,
  verifyDocument,
} from "@sdiqt/protocol";
import { ACCEPTED, type Case, ROOT } from "./common.ts";

const receipt = JSON.parse(
  readFileSync(join(ROOT, "redteam/fixtures/receipt-batch-3.json"), "utf8"),
) as SignedReceiptV1;
const towerKey = JSON.parse(
  readFileSync(join(ROOT, "redteam/fixtures/tower-key.json"), "utf8"),
) as {
  address: string;
  public_key_hex: string;
};
const PUBLIC_KEY = fromHex(towerKey.public_key_hex);

function check(
  body: unknown,
  signatureHex: string,
  context: SigningContext = SIGNING_CONTEXTS.receiptV1,
): string {
  const parsed = ReceiptBodyV1.safeParse(body);
  if (!parsed.success) return `not a receipt v1: ${parsed.error.message}`;
  if (parsed.data.issuer !== towerKey.address)
    return `issuer ${parsed.data.issuer} is not the tower`;
  const ok = verifyDocument(parsed.data, fromHex(signatureHex), PUBLIC_KEY, context);
  return ok ? ACCEPTED : "signature does not verify under the issuer's registered ML-DSA-87 key";
}

export function forgedReceipt(): Case {
  const sig = fromHex(receipt.signature);
  sig[100] = (sig[100] as number) ^ 0x01;
  const edited = { ...receipt.body, state_root: "00".repeat(32) };
  // An attacker's own ML-DSA-87 key, signing the edited body under the right context.
  const attacker = keygen(new Uint8Array(32).fill(0x66));
  const forged = toHex(signDocument(edited, attacker.secretKey, SIGNING_CONTEXTS.receiptV1));
  return {
    id: "5",
    title: "Forged receipt signature",
    code: ["packages/protocol/src/sign.ts: verifyDocument"],
    control: {
      input: `live receipt for sdiqt-1 batch ${receipt.body.batch_index}, issuer ${towerKey.address}`,
      got: check(receipt.body, receipt.signature),
    },
    attempts: [
      {
        attack: "one bit flipped in byte 100 of the signature",
        expect: /^signature does not verify/,
        got: check(receipt.body, toHex(sig)),
      },
      {
        attack: "state_root replaced, original signature kept",
        expect: /^signature does not verify/,
        got: check(edited, receipt.signature),
      },
      {
        attack: "edited body re-signed with an attacker's ML-DSA-87 key, issuer kept",
        expect: /^signature does not verify/,
        got: check(edited, forged),
      },
      {
        attack: "genuine signature checked under the exit packet context",
        expect: /^signature does not verify/,
        got: check(receipt.body, receipt.signature, SIGNING_CONTEXTS.exitPacketV1),
      },
    ],
  };
}
