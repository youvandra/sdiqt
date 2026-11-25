# Statement v1 (`sdiqt-stmt-v1`)

The SDIQT statement is what one SP1 proof attests about one chunk of a qledger-v1 batch: running a range of inbox entries from a state root yields another state root and a list of withdrawals. A batch is one or more chunks whose roots and inbox accumulators chain. Linking the chunks derives the fields the batch posted on QoreChain with `MsgSubmitBatch`, so a verifier compares those fields with the chain.

Reference implementation: `crates/sdiqt-statement/src/lib.rs` (`run_chunk`, `link_chunks`), `crates/sdiqt-guest/src/main.rs` (the SP1 program), `crates/sdiqt-verify/src/lib.rs` (`decode_public_values`), `crates/qledger-core` (execution, inbox accumulator, withdrawals root). Prover input: `crates/sdiqt-statement/src/input.rs` and `BatchInputV1` in `packages/protocol/src/schemas.ts`.

Vectors: `vectors/statement/cases.json`, written by `packages/protocol/scripts/vectors.ts` from the golden bundle `vectors/bundles/golden-v328`. JSON Schema of the prover input: `vectors/statement/batch-input.schema.json`. Tests: `crates/sdiqt-verify/tests/spec_vectors.rs` (decoding and linking), `packages/protocol/test/specs.test.ts` (prover input).

## Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

Each normative rule has an id such as **STMT-1.** and at least one invalid vector in `vectors/statement/cases.json` that cites it. In JSON, integers are canonical decimal strings and bytes are lowercase hex. `lp4(b)` is the 4-byte big-endian length of `b` followed by `b`. `be64(n)` is `n` as 8 bytes big-endian.

## Chunk statement

A chunk proof attests, for public `chain_id`, `rollup_id`, `start_root`, `inbox_from` and `acc_from`, and private entries, witnesses and signature mode:

1. The inbox accumulator after the entries is `acc_to`, where entry `k` (from 1) of the chunk is inbox sequence `inbox_from + k`, and `inbox_to = inbox_from + number of entries`.
2. The witnesses open `start_root` and cover every account the entries touch.
3. Executing the entries with qledger-v1 from `start_root` yields `end_root` and the withdrawals, in order, with their rollup-wide indices.
4. In mode `full`, every ML-DSA-44 transaction signature is checked inside the program. In mode `v0`, the `k`-th signature check returns `sig_bits[k]`, and every bit is used.

When any of these fails the program panics, so no proof of that chunk exists.

The accumulator steps are the chain's (QoreChain v3.2.8 and later):

```text
acc_n = SHA-256("qorechain/rdk/inbox/v1" | lp4(chain_id) | lp4(rollup_id) | acc_{n-1}
                | be64(n) | be64(height) | lp4(poster) | SHA-256(payload))
```

with `acc_0` 32 zero bytes. qledger-v1 execution is the RDK's (`qorechain-rdk` 0.9.0) as vendored in `crates/qledger-core`: an entry that does not parse, carries a bad signature or the wrong nonce, moves zero or more than the balance, or names a non-canonical recipient is a no-op. A deposit entry has poster `deposit:` followed by the depositor. The next withdrawal index lives in the balance of the reserved slot `SHA-256("qledger/v1/withdrawal-counter")`.

## Public values

The program commits one `ChunkOutput` with bincode 1 (legacy options: fixed-width little-endian integers, `u64` lengths). The verifier checks the proof against exactly these bytes.

| Field | Encoding |
|---|---|
| chain_id | `u64` LE byte length, then UTF-8 |
| rollup_id | `u64` LE byte length, then UTF-8 |
| start_root | 32 bytes |
| end_root | 32 bytes |
| inbox_from | `u64` LE |
| inbox_to | `u64` LE |
| acc_from | 32 bytes; 32 zero bytes for the empty inbox |
| acc_to | 32 bytes |
| withdrawals | `u64` LE count, then per withdrawal: `index` `u64` LE, `recipient` (`u64` LE length, then UTF-8 `qor1` address), `amount` `u64` LE in uqor |
| mode | `u32` LE: `0` full, `1` v0 |
| sig_bits | `u64` LE count, then one byte per bit, `0` or `1`; empty in mode full |

Integers here are little-endian, unlike QSTR and every hash input, which are big-endian.

- **STMT-1.** A decoder MUST refuse public values that end before the last field or continue after it.
- **STMT-2.** A decoder MUST refuse a string field that is not valid UTF-8.
- **STMT-3.** A decoder MUST refuse a mode other than `0` or `1`.
- **STMT-4.** A decoder MUST refuse a signature bit byte other than `0` or `1`.

The program commits exactly one `ChunkOutput`, so a byte after `sig_bits` means the bytes did not come from it.

## Linking

A verifier links the decoded chunk outputs of one batch, in chunk order, from the parent state root that the batch claims. The checks run in this order, and the first failure decides the refusal.

- **STMT-5.** A verifier MUST refuse an empty chunk list.
- **STMT-6.** A verifier MUST refuse chunks whose first `start_root` differs from the parent root.
- **STMT-7.** A verifier MUST refuse a chunk whose `chain_id` or `rollup_id` differs from the first chunk's.
- **STMT-8.** A verifier MUST refuse a chunk whose mode differs from the first chunk's.
- **STMT-9.** A verifier MUST refuse a chunk whose `start_root` differs from the previous chunk's `end_root`.
- **STMT-10.** A verifier MUST refuse a chunk whose `inbox_from` differs from the previous chunk's `inbox_to`, or whose `acc_from` differs from the previous chunk's `acc_to`.

## Batch claim

Linked chunks define the batch claim:

| Field | Value |
|---|---|
| chain_id, rollup_id | the first chunk's |
| parent_root | the parent root the chunks start from |
| inbox_from | the first chunk's `inbox_from` |
| inbox_end | the last chunk's `inbox_to` |
| data_hash | `SHA-256("qorechain/rdk/inbox-range/v1" \| lp4(chain_id) \| lp4(rollup_id) \| be64(inbox_from) \| be64(inbox_end) \| acc_from \| acc_to)` with the first chunk's `acc_from` and the last chunk's `acc_to` |
| state_root | the last chunk's `end_root` |
| withdrawals_root | the withdrawals root of every chunk's withdrawals concatenated in order; empty bytes when there is none |
| sig_mode | the common mode |
| chunks | the number of chunks |

The withdrawals root is the chain's v2 tree. With `n` the next power of two at or above the number of withdrawals, the tree has `n` leaves; withdrawal `w` sits at position `w.index mod n`, and every other leaf is 32 zero bytes. A leaf is `SHAKE-256/32(lp4("qorechain-rdk-withdrawal/v2") | lp4(chain_id) | lp4(rollup_id) | be64(index) | lp4(recipient) | lp4("uqor") | be64(amount))` and a node is `SHAKE-256/32(left | right)`.

The bundle verifier compares the claim with the manifest (BND-11), and the manifest is compared with the chain's batch record (BND-12). `data_hash`, `state_root` and `withdrawals_root` are the values `MsgSubmitBatch` carries.

## Program identity

The program is `crates/sdiqt-guest` built for SP1 6.10.0 (`prover.sp1_version` in `config/constants.json`). Each chunk proof is an SP1 compressed STARK. A proof bundle names the program by `program_vkey_hash`: the hex of the bincode-encoded verifying-key digest. A receipt names this statement as `"sdiqt-stmt-v1"`.

The prover splits a batch into chunks of at most `prover.chunk_max_signed_entries` (4) entries so that each chunk fits one prover's memory. The split is a prover choice; any split that links is valid.

## Prover input

The operator hands the prover one batch as JSON `sdiqt-batch-input` v1: `format`, `version`, `chain_id`, `rollup_id`, `batch_index`, `inbox_from`, `acc_from` (empty for the empty inbox), `parent_accounts` (every non-zero account of the parent state as `{ id, balance, nonce }`, including the withdrawal counter slot) and `entries` (`{ height, poster, payload }`). The input stays private to the prover.

- **STMT-11.** A reader MUST refuse a batch input with an unknown field, another `format` or another `version`.
- **STMT-12.** A producer MUST write every integer as a canonical decimal string and every byte string as lowercase hex.

The operator checks STMT-12 with `BatchInputV1`. The Rust prover also refuses uppercase hex, and it reads integers with Rust's `u64` parser, which takes a leading `+` or leading zeros.

## Security considerations

- Validity rests on SP1's compressed STARK and on the verifier pinning `program_vkey_hash`. A verifier that takes the key from the manifest accepts a proof of any program; the watchtower pins the key it was started with.
- A chunk proof alone says nothing about the batch. Linking (STMT-5 to STMT-10) and the claim comparison (BND-11) are what stop a prover from splicing chunks of different batches, dropping a chunk or reordering chunks.
- In mode v0 the signature verdicts are inputs the prover chooses. The bits are public values, so anyone can recheck them against the inbox data, but a v0 proof attests execution given those bits. Receipts and QSTR carry `sig_mode` so readers can tell the modes apart.
- The statement does not commit to `batch_index`. QSTR (QSTR-15) and the chain comparison (BND-12) bind the index.
- The inbox accumulator binds every entry's sequence, height, poster and payload hash. A prover that changes, drops or reorders an entry changes `acc_to` and so `data_hash`, which the chain recorded when the batch was submitted.
- QoreChain settles batches optimistically with fraud proofs and does not check these proofs. The proof is an independent check a watchtower or user runs off chain.
