# QSTR v1 commitment

QSTR is the commitment an SDIQT operator posts to its own rollup inbox with `MsgPostRollupData` after it proves a batch. It names the batch, the program that proved it and the proof bundle, so anyone can fetch the bundle and check it against chain data.

Reference implementation: `packages/protocol/src/qstr.ts`. Test vector: `vectors/qstr/golden-v328.hex` (the QSTR of `vectors/bundles/golden-v328`, prover id `sdiqt-golden`).

## Bytes

All integers are big-endian. `lp(s)` is one length byte (1 to 255) followed by the UTF-8 bytes of `s`.

| Field | Size | Value |
|---|---|---|
| magic | 4 | `"QSTR"` (`51 53 54 52`) |
| version | 1 | `01` |
| chain_id | lp | chain id, for example `qorechain-diana` |
| rollup_id | lp | rollup id, for example `sdiqt-1` |
| batch_index | 8 | batch index on chain |
| inbox_from | 8 | inbox sequence before the batch's first entry |
| inbox_end | 8 | last inbox sequence the batch consumes |
| prev_state_root | 32 | state root before the batch |
| state_root | 32 | state root after the batch |
| withdrawals_root | 32 | withdrawals root of the batch |
| data_hash | 32 | data hash of the batch |
| sig_mode | 1 | `01` full (ML-DSA-44 checked inside the proof), `02` v0 (one validity bit per transaction as a public input); `00` and other values are invalid |
| program_vkey_hash | 32 | verifying-key digest of the SP1 program |
| prover_id | lp | free label of the prover machine |
| chunk_count | 2 | number of chunk proofs, at least 1 |
| proof_root | 32 | `SHA-256("sdiqt/proofs/v1" \|\| be16(n) \|\| sha256(proof_1) \|\| ... \|\| sha256(proof_n))` |
| manifest_sha256 | 32 | SHA-256 of the bundle manifest's canonical bytes (RFC 8785) |

The whole commitment is at most 1,024 bytes (`qstr.max_bytes` in `config/constants.json`). A typical QSTR is about 300 bytes.

## Decoding rules

A decoder refuses the commitment when the magic or version differs, a length byte is 0, a string is invalid UTF-8, `sig_mode` is unknown, `chunk_count` is 0, the bytes end inside a field or bytes remain after `manifest_sha256`.

## Why each part is there

- The first byte `0x51` makes the entry a no-op when qledger-v1 executes the inbox, so a QSTR in the inbox never changes rollup state.
- QSTR has no signature of its own. Its author is the poster of the hybrid-signed L1 transaction, and the inbox accumulator commits to poster and data hash.
- `proof_root` binds the ordered chunk proofs. `manifest_sha256` binds the rest of the bundle: SP1 version, chunk file names and each chunk's public values. A verifier recomputes both from the downloaded bundle and compares them with the posted bytes.
- The batch fields repeat what `MsgSubmitBatch` carries, so a reader can match a QSTR to its batch without the bundle.
