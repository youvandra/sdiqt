# Limits

This file states the security parameters SDIQT relies on and the operational limits of the current deployment of `sdiqt-1` on `qorechain-diana`. Every number names its source: a file in this repository, a pinned dependency, or a cited paper. The threat model that uses these numbers is in [THREAT_MODEL.md](THREAT_MODEL.md).

## Security parameters

### SP1 proof system

The prover and the verifier use SP1 6.10.0 (`config/constants.json` `prover.sp1_version`; `Cargo.lock` pins `sp1-prover`, `sp1-hypercube`, `sp1-core-machine`, `sp1-sdk` and `sp1-verifier` at 6.10.0). Each chunk is proved as an SP1 compressed STARK (`crates/sdiqt-prover/src/bin/sdiqt-prove.rs`, `.compressed()`) and checked with `sp1_verifier::compressed::SP1CompressedVerifierRaw` (`crates/sdiqt-verify/src/lib.rs`). No Groth16 or PLONK wrap is produced or verified anywhere in SDIQT.

SP1 6.x ("Hypercube") commits to multilinear traces with a Basefold polynomial commitment, which uses FRI-style folding and a FRI parameter set. The values below are read from the crate sources in the Cargo registry.

| Parameter | Value | Source (version 6.10.0) |
|---|---|---|
| Base field | KoalaBear, p = 2^31 - 2^24 + 1 (`0x7f000001`) | `sp1-primitives/src/lib.rs` (`SP1Field = KoalaBear`); `p3-koala-bear-0.4.3-succinct/src/koala_bear.rs` |
| Challenge field | degree 4 binomial extension of KoalaBear, about 2^124 elements | `sp1-primitives/src/lib.rs` (`SP1ExtensionField`) |
| Hash | Poseidon2 over KoalaBear, width 16, sponge rate 8, 8-element output | `sp1-primitives/src/lib.rs` (`SP1Perm`, `poseidon2_hasher`) |
| Design target | 100 bits (`SP1_TARGET_BITS_OF_SECURITY`) | `sp1-primitives/src/fri_params.rs` |
| Core and recursion `log_blowup` | 2 (code rate 1/4) | `sp1-primitives/src/fri_params.rs` (`CORE_LOG_BLOWUP`, `RECURSION_LOG_BLOWUP`) |
| Core and recursion proof of work | 16 bits (`SP1_PROOF_OF_WORK_BITS`) | `sp1-primitives/src/fri_params.rs` |
| Core and recursion queries | 124 | `unique_decoding_queries(2)` in `sp1-primitives/src/fri_params.rs`: ceil((100 - 16) / -log2(1/2 + 1/8)) |
| Basefold batch grinding | 5 bits (`BATCH_GRINDING_BITS`) | `slop-basefold/src/verifier.rs` |
| LogUp-GKR grinding | 12 bits (`GKR_GRINDING_BITS`) | `sp1-hypercube/src/verifier/shard.rs` |
| Compressed verifier config | `recursion_fri_config()` | `sp1-verifier/src/compressed/internal.rs` |

The shrink and wrap configurations in the same file (`log_blowup` 3, 22 bits of proof of work, 94 queries) belong to the Groth16 and PLONK path, which SDIQT never runs.

### Provable and conjectured bits

- SP1 6.10.0 sizes its query count with the unique-decoding bound: the function `unique_decoding_queries` in `fri_params.rs` sets each query's soundness error to 1/2 + rate/2, the unique-decoding bound, which proven proximity-gap results cover. At rate 1/4 that gives 124 queries for 84 bits, plus 16 bits of grinding, for the 100-bit target.
- The up-to-capacity conjectures that Crites and Stewart disproved ("On Reed-Solomon Proximity Gaps Conjectures", [ePrint 2025/2046](https://eprint.iacr.org/2025/2046)) are the ones that parameter sets in the list-decoding or capacity regime rely on. The SP1 6.10.0 query count does not use them.
- Block and Tiwari ("On the Concrete Security of Non-interactive FRI", [ePrint 2024/1161](https://eprint.iacr.org/2024/1161)) found that the provable security of deployed non-interactive FRI parameter sets is 21 to 63 bits below their conjectured security, for all sets but one. Their analysis covers the Fiat-Shamir transform and the full protocol. We have not computed a provable bit count for the whole SP1 6.10.0 protocol (Basefold, sumcheck, LogUp-GKR, the degree 4 challenge field and Fiat-Shamir with Poseidon2), so the 100-bit figure is SP1's design target as written in its source, and SDIQT does not claim a provable number for the full system.
- Grover-type search gives a quantum attacker a square-root speedup on the generic-search parts of a hash-based proof, such as grinding and Fiat-Shamir. SDIQT states no quantum bit count for the STARK.

### Signatures and key encapsulation

| Use | Scheme | Level | Source |
|---|---|---|---|
| qledger-v1 user entries (transfers, withdrawals), exit packet headers and cancels | ML-DSA-44, FIPS 204 context `qledger/v1`; public key 1,312 bytes, signature 2,420 bytes | NIST category 2 (FIPS 204) | `crates/qledger-core/src/tx.rs`; `specs/exit-packet-v1.md` |
| L1 transactions of the operator, the watchtower and the demo user | hybrid: secp256k1 plus a registered ML-DSA-87 key | ML-DSA-87 is NIST category 5 (FIPS 204) | `packages/chain/src/operator-key.ts`; registration txs in [PROOF.md](PROOF.md) |
| Settlement receipts | ML-DSA-87, context `sdiqt/receipt/v1` | NIST category 5 | `apps/watchtower/src/receipt.ts`; `packages/protocol/src/sign.ts` |
| Exit packet sealing | QoreSeal mode `mlkem`, one recipient: the tower's ML-KEM-1024 key | NIST category 5 (FIPS 203) | `apps/operator/src/exit-packet.ts`; `specs/exit-packet-v1.md` |
| QoreChain consensus | Ed25519 validator keys | classical only; Shor's algorithm breaks it | QoreChain PQ light client documentation ([qorechain-pq-light-client](https://github.com/qorechain/qorechain-pq-light-client)) |

ML-DSA-44 is the only account scheme qledger-v1 accepts (`QLEDGER_SCHEME_MLDSA44 = 1` in `tx.rs`), so user funds on the rollup sit at category 2 whatever key the user's L1 account holds.

## On-chain verification

QoreChain does not verify SDIQT's STARKs. From chain v3.2.8 a STARK verification key cannot be set and a STARK rollup's batches are refused with error 52; `@qorechain/rdk` 0.9.0 lists `stark` in its paused proof systems and refuses it before broadcast. `sdiqt-1` is therefore an optimistic rollup (`execution_vm` `qledger-v1`, `config/constants.json`), and the STARK is a validity attestation checked off chain by the watchtower and by anyone who runs `sdiqt verify` or `node scripts/proof.mjs --check`.

## Operational limits

### Rollup and batching

| Limit | Value | Source |
|---|---|---|
| Challenge window | 3,600 s | `config/constants.json` `rollup.challenge_window_s`; `docs/counts.json` |
| Entries per batch | at most 64 | `config/constants.json` `rollup.max_entries_per_batch` |
| Idle blocks before a partial batch is cut | 20 | `config/constants.json` `rollup.batch_idle_blocks`; `apps/operator/src/plan.ts` |
| QSTR size | at most 1,024 bytes, about 300 bytes typical | `config/constants.json` `qstr.max_bytes`; `specs/qstr-v1.md` |
| Rollup stake and submitter bond | 10,000 QOR and 1,000 QOR | `docs/claims.json` |
| Retention of finalized batch records | the chain's `finalized_batch_retention_blocks`; after it the tower settles from the signed anchor | `apps/watchtower/src/settle.ts` |

### Prover

Measured on one Apple M5 machine (10 cores, 16 GB), SP1 6.10.0 CPU prover, signatures checked inside the proof, per [docs/prover-calibration.md](docs/prover-calibration.md).

| Limit | Value | Source |
|---|---|---|
| Signed entries per chunk | at most 4 | `config/constants.json` `prover.chunk_max_signed_entries` |
| Cycles per chunk | at most 6,100,000 | `config/constants.json` `prover.chunk_max_cycles` |
| Proof deadline | 3,300 s after the batch submit | `config/constants.json` `prover.proof_deadline_s` |
| Cycles per signed transfer | about 1.0M, about 2.0M when it opens an account | `docs/prover-calibration.md` |
| Cycles per deposit or no-op entry | a few thousand (5,600 to 6,798 measured) | `docs/prover-calibration.md` |
| Prove time, 4-entry chunk | 145 to 168 s (192 s at 6.06M cycles) | `docs/prover-calibration.md` |
| Proof size per chunk | about 1.27 MB (1,272,546 to 1,272,912 bytes) | `docs/prover-calibration.md` |
| Peak resident memory per chunk | 9.8 to 10.8 GB | `docs/prover-calibration.md` |
| Concurrent proofs | 1 | `apps/operator/src/prove-queue.ts` |
| 64-entry batch | 16 chunks; 45 to 48 min projected on an idle machine, 72 min (4,341 s) measured on a shared 16 GB Mac (batch 19) | `docs/prover-calibration.md` |
| Sustained throughput | about 86 signed entries per hour idle, about 53 measured shared | idle: 3,600 / 168 x 4 = 85.7; shared: 64 entries in 4,341 s (batch 19) |
| Measured submit-to-QSTR latency | median 1,033 s, longest 1,129 s, over 4 batches | `docs/counts.json`; [PROOF.md](PROOF.md) |

An 11-entry chunk (11.6M cycles) fails during compression on this machine, which is why the chunk caps sit at 4 entries and 6.1M cycles.

### Watchtower and exit packets

| Limit | Value | Source |
|---|---|---|
| Tick interval | 30 s (operator: 15 s) | `apps/watchtower/src/cli.ts`; `apps/operator/src/cli.ts` |
| Exit request body | at most 64 KiB; a packet is about 16 kB | `apps/watchtower/src/api.ts` `MAX_EXIT_BODY_BYTES`; `specs/exit-packet-v1.md` |
| Stored exit packets | one per account, the newest `seq` | `specs/exit-packet-v1.md` |
| Post retries for a released packet | 3 | `specs/exit-packet-v1.md` |
| Daily spend caps (defaults) | operator 50 QOR, tower challenge 1,050 QOR, tower exit posts 2 QOR | `apps/operator/src/cli.ts`; `apps/watchtower/src/cli.ts` |
| Tower process memory | at most 256 MB | `deploy/systemd/sdiqt-watchtower.service` |
| Challenge path in the deployed tower | on since 26 Nov 2026 (`--challenge`, 30 s poll); in the staged run an independent challenger was faster | `deploy/systemd/sdiqt-watchtower.service` |
