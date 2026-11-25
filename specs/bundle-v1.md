# Proof bundle v1

A proof bundle holds the chunk proofs of one batch and a manifest that says which batch they prove. The operator uploads one bundle per proven batch and posts a QSTR that commits to it. Anyone can download the bundle and verify it with the `sdiqt-verify` CLI, the WebAssembly build in Node or the browser, or the Rust library.

Reference implementation: `crates/sdiqt-verify/src/bundle.rs` (manifest, canonical bytes, proof root), `crates/sdiqt-verify/src/lib.rs` (`verify_bundle`, `verify_bundle_json`), `crates/sdiqt-verify/src/bin/sdiqt-verify.rs` (CLI), `BundleManifestV1` in `packages/protocol/src/schemas.ts`, `packages/verify/src/match.ts` (`manifestVsBatch`).

Vectors: `vectors/bundles/cases.json`, written by `packages/protocol/scripts/vectors.ts` over the golden bundle `vectors/bundles/golden-v328`. JSON Schema of the manifest: `vectors/bundles/manifest.schema.json`. Tests: `crates/sdiqt-verify/tests/spec_vectors.rs` (reader and verifier), `packages/verify/test/specs.test.ts` (schema and chain match).

## Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

Each normative rule has an id such as **BND-1.** and at least one invalid vector in `vectors/bundles/cases.json` that cites it. Integers are canonical decimal strings and bytes are lowercase hex.

## Layout

A bundle is a directory, named `batch-<batch_index>-<first 12 characters of the submit tx hash>` when the operator uploads it, with:

- `manifest.json`: the manifest below, in canonical form (RFC 8785: keys sorted at every level, no whitespace). The manifest holds only strings, arrays and objects, so its canonical form needs no number formatting.
- `chunk-<i>.bin` for each chunk `i` from 0: the bincode of the SDK's `SP1Proof::Compressed` for that chunk.

## Manifest

| Field | Value |
|---|---|
| `format` | `"sdiqt-proof-bundle"` |
| `version` | `"1"` |
| `chain_id`, `rollup_id` | where the batch runs |
| `batch_index` | batch index on chain |
| `inbox_from`, `inbox_end` | inbox range the batch consumes (statement claim) |
| `parent_root` | state root before the batch |
| `state_root` | state root after the batch |
| `withdrawals_root` | withdrawals root; empty when the batch has no withdrawals |
| `data_hash` | inbox range commitment |
| `sig_mode` | `"full"` or `"v0"` |
| `sp1_version` | SP1 version of the prover, for example `"6.10.0"` |
| `program_vkey_hash` | hex of the bincode-encoded verifying-key digest of the program |
| `proof_root` | `SHA-256("sdiqt/proofs/v1" \|\| be16(n) \|\| sha256(chunk_0) \|\| ... \|\| sha256(chunk_{n-1}))` |
| `chunks` | one entry per chunk, in order: `{ index, file, proof_sha256, public_values }` |

`proof_sha256` is the SHA-256 of the chunk file and `public_values` the chunk's committed public values (statement spec, section Public values). The SHA-256 of the canonical manifest bytes is the `manifest_sha256` a QSTR commits to.

- **BND-1.** A verifier MUST refuse a manifest whose `format` or `version` differs, or that has an unknown field.
- **BND-2.** A reader of a bundle directory MUST refuse a `manifest.json` that is not in canonical form.
- **BND-3.** A manifest MUST match `BundleManifestV1`: at least one chunk, every `file` of the form `chunk-<digits>.bin`, every integer a canonical decimal string and every hash 64 lowercase hex digits.

The CLI applies BND-2 when it reads a directory. The JSON entry point that the WebAssembly builds expose takes the manifest text as given, and a reader that hashes a manifest hashes its canonical bytes, so a non-canonical copy yields the same `manifest_sha256`. The Rust verifier checks the hex fields and integers it decodes and applies BND-6 to every `file`, so the CLI never reads a path the manifest invents; the TypeScript schema applies the BND-3 pattern before the watchtower and the explorer fetch chunk files.

## Verification

`verify_bundle(manifest, proofs, expected_vkey_hash)` takes the manifest, the chunk files in manifest order and, optionally, the program key to pin. It runs these checks in order and stops at the first failure:

- **BND-4.** When a program key is pinned, a verifier MUST refuse a manifest whose `program_vkey_hash` differs from it.
- **BND-5.** A verifier MUST refuse a bundle whose number of chunk files differs from the number of manifest chunks.
- **BND-6.** A verifier MUST refuse a manifest whose chunk at position `i` has an `index` other than `i` or a `file` other than `chunk-<i>.bin`.
- **BND-7.** A verifier MUST refuse a chunk file whose SHA-256 differs from its `proof_sha256`.
- **BND-8.** A verifier MUST refuse a chunk whose proof does not verify as an SP1 compressed STARK against `program_vkey_hash` and the chunk's `public_values`.
- **BND-9.** A verifier MUST refuse a manifest whose `proof_root` differs from the root of the chunk files' hashes.
- **BND-10.** A verifier MUST refuse chunks whose decoded public values do not link from `parent_root` (statement rules STMT-5 to STMT-10).
- **BND-11.** A verifier MUST refuse a bundle whose linked claim differs from the manifest in `chain_id`, `rollup_id`, `inbox_from`, `inbox_end`, `state_root`, `withdrawals_root`, `data_hash` or `sig_mode`.

Public values are decoded (statement rules STMT-1 to STMT-4) after the proof check, so a decode failure on a verified proof would mean the program committed bytes it cannot read.

A bundle that passes is a proof of the manifest's claim. To use it for a batch on chain, a verifier also compares the manifest with the chain's batch record:

- **BND-12.** A verifier MUST refuse a bundle whose `batch_index`, `parent_root`, `state_root`, `withdrawals_root`, `data_hash`, `inbox_from` or `inbox_end` differs from the chain's batch (`batch_index`, `prev_state_root`, `state_root`, `withdrawals_root`, `data_hash`, `inbox_start`, `inbox_end`).

The watchtower runs BND-1 to BND-11 through the WebAssembly build with the program key pinned, then QSTR-15, QSTR-16 and BND-12. Only when all pass is the batch `proven` in its receipts.

## CLI

```bash
sdiqt-verify bundle <dir> [--vkey-hash HEX]
```

Exit code 0 prints `VALID` and the batch it proves, 1 prints `INVALID` and the first failed check, 2 is a usage error.

## Security considerations

- Pin the program. Without `--vkey-hash` (or `expected_vkey_hash`), BND-4 is skipped and the manifest chooses the program, so a valid bundle may prove a program other than SDIQT's.
- The proof does not cover `batch_index`, `parent_root` against the chain, or `sp1_version`. BND-12 binds the batch fields to the chain, and `manifest_sha256` in the QSTR binds the whole manifest to the operator's post.
- `proof_sha256` and `proof_root` make the chunk files content-addressed, so a bundle host cannot change a proof without the manifest and the QSTR changing too. A host can still withhold a bundle; the tower then reports the batch as not proven yet and, after the proof deadline, as `unproven`.
- The CLI reads chunk files named by the manifest relative to the bundle directory. Readers that fetch files apply the `file` pattern of BND-3 first.
- Verification is hash-based end to end: SP1 compressed STARKs with no pairing-based wrap, and SHA-256 for file hashes, the proof root and the manifest hash.
