# Receipt v1

A receipt is the watchtower's signed statement about one batch submission: what QoreChain says about its settlement, and whether a verified STARK bundle attests the roots the chain holds. Every field is re-derivable from chain data and the bundle, which is what a careful reader does; the signature tells the reader which tower said it and that nobody changed it since.

Reference implementation: `ReceiptBodyV1` and `SignedReceiptV1` in `packages/protocol/src/schemas.ts`, `packages/protocol/src/sign.ts` (ML-DSA-87 context signing), `packages/protocol/src/jcs.ts` (canonical JSON), `apps/watchtower/src/receipt.ts` and `apps/watchtower/src/tower.ts` (issuance), `apps/watchtower/src/settle.ts` (settlement and validity).

Vectors: `vectors/receipt/cases.json`, written by `packages/protocol/scripts/vectors.ts` with the ML-DSA-87 key of seed `07` repeated 32 times. JSON Schema: `vectors/receipt/receipt.schema.json`. Tests: `packages/protocol/test/specs.test.ts`.

## Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

Each normative rule has an id such as **RCPT-1.** and at least one invalid vector in `vectors/receipt/cases.json` that cites it.

## Signed receipt

`{ body, signature }`. `signature` is the lowercase hex ML-DSA-87 signature (FIPS 204, pure, deterministic or hedged) of the body's canonical bytes under the context string `sdiqt/receipt/v1`. Canonical bytes are RFC 8785 JSON in UTF-8: keys sorted by UTF-16 code units at every level, no whitespace. SDIQT documents hold no JSON numbers, so canonical form needs no number formatting.

## Body

| Field | Value |
|---|---|
| `format`, `version` | `"sdiqt-receipt"`, `"1"` |
| `chain_id`, `rollup_id` | where the batch runs |
| `batch_index` | batch index on chain |
| `prev_state_root`, `state_root`, `withdrawals_root`, `data_hash` | the roots the submission put on chain; `withdrawals_root` is empty when the batch has no withdrawals |
| `inbox_from`, `inbox_end` | the inbox range the batch consumes |
| `submit_tx` | lowercase hex hash of the `MsgSubmitBatch` transaction |
| `submit_height` | height of that transaction |
| `submitted_time` | block time of the submission |
| `challenge_deadline` | `submitted_time` plus the rollup's challenge window |
| `settlement` | `pending`, `final` or `rejected` (below) |
| `validity` | `proving`, `proven`, `mismatch` or `unproven` (below) |
| `anchor` | `{ layer_id, layer_height }`: the rollup id and batch index of the anchor QoreChain stores for the batch |
| `proof` | when `validity` is `proven`: `{ statement: "sdiqt-stmt-v1", sig_mode, program_vkey_hash, prover_id, chunk_count, proof_root, qstr_sequence, qstr_tx }` from the QSTR that named the verified bundle, with its inbox sequence and lowercase transaction hash; otherwise `null` |
| `soundness_note` | plain-language summary of what the two states mean |
| `issued_height` | chain height when the tower issued the receipt |
| `issuer` | the tower's `qor1` account, whose registered ML-DSA-87 key signs; a development tower writes `dev:` and the first 16 hex digits of the SHA-256 of its public key |

Integers are canonical decimal strings, hashes and other bytes lowercase hex, and times RFC 3339 date-times in UTC with a `Z` suffix.

- **RCPT-1.** A verifier MUST refuse a receipt or body with an unknown field.
- **RCPT-2.** A verifier MUST refuse a body whose `format` or `version` differs.
- **RCPT-3.** A verifier MUST refuse an integer field that is not a canonical decimal string, a JSON number included.
- **RCPT-4.** A verifier MUST refuse a hex field, or a signature, that is not lowercase hex.
- **RCPT-5.** A verifier MUST refuse a time field that is not an RFC 3339 UTC date-time.
- **RCPT-6.** A verifier MUST refuse a `settlement` or `validity` outside the values above.
- **RCPT-7.** A verifier MUST refuse a `proof` whose `statement` is not `"sdiqt-stmt-v1"`.
- **RCPT-8.** A verifier MUST refuse a receipt whose signature does not verify over the canonical bytes of the body as received.
- **RCPT-9.** A verifier MUST verify with the context string `sdiqt/receipt/v1` and refuse a signature made under any other context.
- **RCPT-10.** A verifier MUST verify with the issuer's ML-DSA-87 public key and refuse a signature by any other key.

The issuer's key is the ML-DSA-87 key registered on QoreChain for the `issuer` account. The vectors use a fixed test key and publish its seed.

## Settlement

Settlement is what QoreChain says. While the chain holds the batch record at `batch_index`, the tower compares its `state_root`, `withdrawals_root` and `data_hash` with the submission's: a difference, or an index reused after an upheld challenge, is `rejected`; otherwise the record's status decides (`finalized` is `final`, `rejected` is `rejected`, anything else `pending`). After the chain prunes a finalized record, a settlement stored earlier stays, and a batch older than the retention period with a matching anchor is `final`. When neither applies the settlement is unknown, and the tower issues no receipt.

## Validity

Validity is SDIQT's own. `mismatch` means the tower re-executed the batch from the archived inbox and got other roots than the chain holds. `proven` means a QSTR from the operator named a bundle that passes BND-1 to BND-12, QSTR-15 and QSTR-16. Otherwise the batch is `proving` until `submitted_time` plus `prover.proof_deadline_s` (3,300 seconds, inside the 3,600 second challenge window) and `unproven` after.

## Issuance

The tower issues a receipt once the batch has an anchor, a known settlement and a known submission time. It issues a new receipt for the same submission whenever `settlement`, `validity`, `proof.proof_root` or `proof.qstr_tx` changes, and keeps the earlier ones. `GET /api/receipts/<batch_index>` returns the latest receipt of the current submission at that index.

## Security considerations

- A receipt is a signed claim by one tower. It does not change what the chain settles, and a reader that needs certainty re-derives settlement from the chain and validity from the bundle.
- Settlement and validity are separate axes on purpose: a batch can be `final` on chain and `mismatch` for SDIQT, which is the case a reader most needs to see.
- The context string separates receipts from every other SDIQT signature (RCPT-9), so a receipt signature cannot be replayed as an exit packet signature or the reverse.
- The signature covers canonical bytes, so field order and whitespace do not matter, and any change of a value does (RCPT-8). Refusing JSON numbers (RCPT-3) keeps canonical bytes free of float formatting.
- `issued_height` and the receipt history show when the tower said what. A tower that stops issuing leaves the last receipt in place; readers compare `issued_height` with the chain tip.
- ML-DSA-87 is a post-quantum signature at NIST security category 5.
