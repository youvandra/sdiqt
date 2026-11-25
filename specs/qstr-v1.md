# QSTR v1 commitment

QSTR is the commitment an SDIQT operator posts to its own rollup inbox with `MsgPostRollupData` after it proves a batch. It names the batch, the program that proved it and the proof bundle, so anyone can fetch the bundle and check it against chain data.

Reference implementation: `packages/protocol/src/qstr.ts` (`encodeQstrV1`, `decodeQstrV1`, `qstrFromManifest`), `packages/verify/src/match.ts` (`qstrVsManifest`), `apps/operator/src/qstr.ts` (reading QSTR posts from the archive).

Vectors: `vectors/qstr/golden-v328.hex` (the QSTR of `vectors/bundles/golden-v328`, prover id `sdiqt-golden`) and `vectors/qstr/cases.json`, written by `packages/protocol/scripts/vectors.ts`. QSTR is binary, so the vectors give each commitment as hex next to its decoded fields; there is no JSON Schema. Tests: `packages/protocol/test/specs.test.ts` (encoding and decoding), `packages/verify/test/specs.test.ts` (QSTR against the bundle).

## Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

Each normative rule has an id such as **QSTR-1.** and at least one invalid vector in `vectors/qstr/cases.json` that cites it.

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
| withdrawals_root | 32 | withdrawals root of the batch; 32 zero bytes when the batch has no withdrawals (the chain records an empty root) |
| data_hash | 32 | data hash of the batch |
| sig_mode | 1 | `01` full (ML-DSA-44 checked inside the proof), `02` v0 (one validity bit per transaction as a public input) |
| program_vkey_hash | 32 | verifying-key digest of the SP1 program |
| prover_id | lp | free label of the prover machine |
| chunk_count | 2 | number of chunk proofs |
| proof_root | 32 | `SHA-256("sdiqt/proofs/v1" \|\| be16(n) \|\| sha256(proof_1) \|\| ... \|\| sha256(proof_n))` |
| manifest_sha256 | 32 | SHA-256 of the bundle manifest's canonical bytes (RFC 8785) |

The whole commitment is at most 1,024 bytes (`qstr.max_bytes` in `config/constants.json`); three strings of 255 bytes give exactly 1,024. A typical QSTR is about 300 bytes. In decoded form a withdrawals root of 32 zero bytes reads back as the empty string, since no SHA-256 root is all zeros.

## Decoding

- **QSTR-1.** A decoder MUST refuse more than 1,024 bytes.
- **QSTR-2.** A decoder MUST refuse a magic other than `"QSTR"`.
- **QSTR-3.** A decoder MUST refuse a version other than `01`.
- **QSTR-4.** A decoder MUST refuse a length byte of 0.
- **QSTR-5.** A decoder MUST refuse a string that is not valid UTF-8.
- **QSTR-6.** A decoder MUST refuse a `sig_mode` byte other than `01` or `02`.
- **QSTR-7.** A decoder MUST refuse a `chunk_count` of 0.
- **QSTR-8.** A decoder MUST refuse bytes that end inside a field.
- **QSTR-9.** A decoder MUST refuse bytes after `manifest_sha256`.

## Encoding

The encoder takes integers as decimal strings and bytes as lowercase hex, as every SDIQT JSON format does.

- **QSTR-10.** An encoder MUST refuse an integer that is not a canonical decimal string or does not fit in 64 bits.
- **QSTR-11.** An encoder MUST refuse a `chain_id`, `rollup_id` or `prover_id` outside 1 to 255 UTF-8 bytes.
- **QSTR-12.** An encoder MUST refuse a 32-byte field that is not 64 lowercase hex digits; the empty withdrawals root is the one exception and encodes as 32 zero bytes.
- **QSTR-13.** An encoder MUST refuse a `chunk_count` outside 1 to 65,535.
- **QSTR-14.** An encoder MUST refuse a `sig_mode` other than `full` or `v0`.

## Checking a QSTR against its bundle

The tower fetches the bundle of a batch from `batch-<batch_index>-<first 12 characters of the submit tx hash>` under the operator's bundle base URL. Before it treats the batch as proven, a verifier checks the bundle (bundle rules BND-1 to BND-11) and then the QSTR against the bundle's manifest:

- **QSTR-15.** A verifier MUST refuse a QSTR whose `chain_id`, `rollup_id`, `batch_index`, `inbox_from`, `inbox_end`, `prev_state_root` (manifest `parent_root`), `state_root`, `withdrawals_root`, `data_hash`, `sig_mode`, `program_vkey_hash`, `chunk_count` (number of manifest chunks) or `proof_root` differs from the manifest.
- **QSTR-16.** A verifier MUST refuse a QSTR whose `manifest_sha256` differs from the SHA-256 of the canonical bytes of the manifest it downloaded.

`qstrFromManifest` builds a QSTR from a manifest and refuses a manifest whose `proof_root` does not match its chunks' `proof_sha256` values.

The tower reads QSTR posts only from the operator address it was configured with, skips posts from that address that start with `QSTR` but do not decode, and uses the QSTR whose `batch_index`, `state_root` and `inbox_end` equal the chain batch's.

## Security considerations

- The first byte `0x51` makes the entry a no-op when qledger-v1 executes the inbox, so a QSTR in the inbox never changes rollup state.
- QSTR has no signature of its own. Its author is the poster of the hybrid-signed L1 transaction, and the inbox accumulator commits to poster and data hash. Anyone can post to a based inbox, so a reader that accepts QSTR posts from any poster accepts commitments anyone wrote; the tower filters by the operator address.
- `proof_root` binds the ordered chunk proofs. `manifest_sha256` binds the rest of the bundle: SP1 version, chunk file names and each chunk's public values. A verifier recomputes both from the downloaded bundle and compares them with the posted bytes, so a bundle host cannot swap the bundle after the post.
- The batch fields repeat what `MsgSubmitBatch` carries, so a reader can match a QSTR to its batch without the bundle. A QSTR is a claim by the operator; it says nothing about validity until the bundle it names verifies.
- Strict decoding (QSTR-1 to QSTR-9) gives each commitment exactly one byte form, so two readers cannot decode the same post to different fields.
