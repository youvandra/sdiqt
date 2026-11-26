# Threat model

SDIQT adds STARK validity receipts to `sdiqt-1`, a based qledger-v1 rollup on QoreChain `qorechain-diana`. This file lists what SDIQT protects, who can attack it, what stops each attack, and what risk remains. Parameters and capacities are in [LIMITS.md](LIMITS.md); on-chain evidence is in [PROOF.md](PROOF.md).

## System in one paragraph

Users post ML-DSA-44 signed qledger entries to the rollup inbox with `MsgPostRollupData`. The operator cuts a batch from the inbox, checks its roots twice (the RDK fraud check and the Rust statement must agree), and submits it anchored with its ML-DSA-87 key. QoreChain settles the batch optimistically: it becomes final after a 3,600 s challenge window unless a fraud proof is upheld. Off chain, the operator's machine proves the batch as SP1 compressed STARK chunks, uploads the bundle and posts a QSTR commitment to the inbox. The watchtower re-executes every batch, verifies every bundle against the chain and the QSTR, and signs a receipt with ML-DSA-87 that carries two axes: settlement (from the chain) and validity (from the STARK). Users can also hand the tower an exit packet: a signed withdrawal sealed to the tower's ML-KEM-1024 key, which the tower posts at a chosen height.

## Assets

- Rollup funds: L2 balances and the withdrawals the chain pays with `MsgExecuteWithdrawal` once a batch is final.
- The validity attestation: the statement "this batch's roots are the honest execution of its inbox", carried by a bundle, a QSTR and a receipt.
- Keys: the operator mnemonic and ML-DSA-87 key, the tower's ML-DSA-87 receipt key and ML-KEM-1024 key, users' ML-DSA-44 qledger keys.
- Liveness: batches proven within the deadline, receipts issued, exit packets posted on time.
- Privacy of sealed exit packets until their release height.

## Attackers

- A bonded batch submitter: the operator itself or any third party that bonds as a submitter for `sdiqt-1`.
- Anyone who pays gas to post to the inbox.
- Whoever controls the operator's machine or the tower's server.
- A dishonest or offline watchtower.
- A future quantum adversary, against classical keys today and against anything posted today.
- A network attacker between a user and the tower's API.

## Threats

### 1. A wrong state root finalizes

- **Asset:** rollup funds. A batch with a wrong state or withdrawals root that finalizes lets its withdrawals be paid from the rollup's escrow.
- **Attacker:** a bonded submitter, including a compromised operator key.
- **What stops it:** settlement is optimistic, so the chain's own guard is a qledger fraud proof upheld inside the 3,600 s window. The operator refuses to submit any batch its dual self-check rejects. The watchtower re-executes every batch from its archive and compares the roots the chain holds; a difference marks the batch `mismatch`. The tower's challenge path builds the fraud proof and sends it only after `checkQledgerFraud` agrees locally, through a simulate-first transaction under a spend cap. The operator never proves a mismatched batch, so no STARK attests a wrong root.
- **Residual risk:** the STARK does not gate settlement (threat 2). The deployed tower runs with the challenge path on since 26 Nov 2026 and polls every 30 s. In the staged run on diana (batch 12) an independent challenger reached the chain 7 s after the submit, ahead of our tower, which then labelled the rejection and the mismatch in its receipt. If nobody challenges within 3,600 s, the chain finalizes the wrong root.
- **Code:** `apps/operator/src/selfcheck.ts`, `apps/operator/src/plan.ts`, `apps/watchtower/src/judge.ts`, `apps/watchtower/src/challenge.ts`, `packages/chain/src/safe-tx.ts`, `deploy/systemd/sdiqt-watchtower.service`.

### 2. The chain never reads the STARK

- **Asset:** the meaning of "proven".
- **Attacker:** anyone who presents a receipt or explorer page as on-chain finality.
- **What stops it:** QoreChain refuses STARK verification keys and STARK batches from v3.2.8 (error 52), and `@qorechain/rdk` 0.9.0 refuses the `stark` proof system before broadcast. SDIQT therefore keeps the two axes apart: every receipt states settlement and validity separately and carries a soundness note that says QoreChain does not verify the proof.
- **Residual risk:** validity is an off-chain attestation. Its value depends on someone checking it: the tower, or a reader who runs `sdiqt verify` or `node scripts/proof.mjs --check`.
- **Code:** `apps/watchtower/src/receipt.ts` (`SOUNDNESS_NOTE`), `apps/watchtower/src/settle.ts`.

### 3. A forged or unsound proof

- **Asset:** the validity attestation.
- **Attacker:** a prover that wants a false batch to read `proven`.
- **What stops it:** each chunk is an SP1 6.10.0 compressed STARK with a 100-bit design target, 124 queries at rate 1/4 sized by the unique-decoding bound, and 16 bits of proof of work (LIMITS.md). The bundle verifier links chunks into exactly the batch the manifest claims, and the tower then compares the manifest with the chain's batch record and with the QSTR field by field. `proof_root` and `manifest_sha256` in the QSTR bind the ordered chunk proofs and the rest of the bundle.
- **Residual risk:** SDIQT has no provable bit count for the full SP1 protocol; Block and Tiwari ([ePrint 2024/1161](https://eprint.iacr.org/2024/1161)) show provable security of deployed FRI sets running 21 to 63 bits below conjecture, and the 2025 disproof of up-to-capacity proximity-gap conjectures ([ePrint 2025/2046](https://eprint.iacr.org/2025/2046)) concerns parameter regimes beyond the one SP1 6.10.0 uses for its query count. An implementation bug in SP1 or in the SDIQT statement would also produce a valid-looking proof; neither has had an external audit.
- **Code:** `crates/sdiqt-guest/src/main.rs`, `crates/sdiqt-statement/src/lib.rs`, `crates/sdiqt-verify/src/lib.rs`, `packages/verify/src/match.ts`, `specs/qstr-v1.md`.

### 4. The wrong program

- **Asset:** the validity attestation.
- **Attacker:** a prover that proves a different guest program and names it in its manifest.
- **What stops it:** the deployed tower pins the program verifying-key hash (`--vkey-hash db524751...2065`) and refuses bundles for any other program; the QSTR carries `program_vkey_hash`.
- **Residual risk:** a verifier run without a pinned hash trusts the manifest's own value (`verify_bundle` with `None`). A reader must take the hash from a trusted build of `crates/sdiqt-guest`.
- **Code:** `crates/sdiqt-verify/src/lib.rs` (`verify_bundle`), `apps/watchtower/src/tower.ts`, `deploy/systemd/sdiqt-watchtower.service`.

### 5. Third-party batches and commitments

- **Asset:** rollup funds and the validity record.
- **Attacker:** another bonded submitter, or anyone posting a QSTR-shaped entry.
- **What stops it:** sequencing is based, so any bonded submitter may batch the inbox. The operator checks and proves whatever batch lands, then plans from the new consumed position. A third-party batch with wrong roots becomes `mismatch` and goes to the challenge path of threat 1. The tower reads QSTRs only from the operator's address, so a commitment posted by anyone else never makes a batch `proven`. A QSTR's first byte `0x51` makes it a no-op in qledger execution.
- **Residual risk:** a third party can batch first and choose which pending entries land in which batch, within based ordering. Rollup state is unaffected by stray QSTRs, but they still cost the prover a few thousand cycles each.
- **Code:** `apps/operator/src/operator.ts`, `apps/watchtower/src/tower.ts` (`archivedQstrs`), `specs/qstr-v1.md`.

### 6. Inbox spam against prover capacity

- **Asset:** liveness of the validity attestation.
- **Attacker:** anyone who pays gas to post to the inbox.
- **What stops it:** qledger execution checks the signature before the nonce and balance, so a well-formed signed entry costs a full ML-DSA-44 verification inside the proof even from an empty account: about 1.0M cycles, or 2.0M when it opens an account. Undecodable entries and deposits cost a few thousand cycles. One machine proves about 86 signed entries per hour (LIMITS.md). A batch the prover misses by its 3,300 s deadline is labelled `unproven` in its receipt.
- **Residual risk:** sustained posting above about 86 signed entries per hour grows the proof backlog without bound, and batches settle optimistically while their validity reads `proving` or `unproven`. Settlement and funds are unaffected; the attestation lags. Posting fees are the only cost to the attacker.
- **Code:** `crates/qledger-core/src/exec.rs`, `apps/operator/src/prove-queue.ts`, `apps/watchtower/src/settle.ts` (`validity`), `docs/prover-calibration.md`.

### 7. One machine proves everything

- **Asset:** liveness of proving; the operator key.
- **Attacker:** hardware failure, power or network loss, or whoever gains control of the machine.
- **What stops it:** the operator and the prover run on one Apple M5 machine with one proof at a time. The prove queue keeps its state in one file written atomically, so a restart resumes and retries a job caught mid-proof. Sends go through `SafeTx` with a daily cap of 50 QOR by default. A bundle the operator produces is verified again by the tower, so a compromised prover still cannot make a false batch read `proven`.
- **Residual risk:** while the machine is down, no batch is proven and the operator submits no batches; another bonded submitter can still batch the inbox. Whoever holds the operator mnemonic can submit wrong-root batches (threat 1) and post QSTRs as the operator, up to the spend cap and the bond.
- **Code:** `apps/operator/src/prove-queue.ts`, `apps/operator/src/prover-process.ts`, `packages/chain/src/spend-cap.ts`, `packages/chain/src/operator-key.ts`.

### 8. Trusting the watchtower

- **Asset:** receipts, challenges and exit packet delivery.
- **Attacker:** a dishonest, compromised or offline tower.
- **What stops it:** every receipt field is re-derivable from chain data plus the bundle; a reader checks a receipt against the chain with `sdiqt verify` or `node scripts/proof.mjs --check`, and the tower's API serves the same rows as the operator's own archive. Receipts are signed with the ML-DSA-87 key the tower registered on chain, so a forged receipt from anyone else fails. The tower runs under systemd with a 256 MB memory cap, a read-only app directory and an exit-post spend cap of 2 QOR per day.
- **Residual risk:** there is one tower. If it is offline, no receipts are issued, no challenges are sent and no exit packets are posted. A tower that holds its key can sign a false receipt; only a reader who re-checks it catches the lie. The tower's server holds both its ML-DSA-87 and ML-KEM-1024 secrets.
- **Code:** `apps/watchtower/src/receipt.ts`, `apps/watchtower/src/tower.ts`, `apps/watchtower/src/api.ts`, `deploy/systemd/sdiqt-watchtower.service`, `scripts/proof.mjs`.

### 9. Ed25519 consensus

- **Asset:** the chain itself: every settlement, withdrawal and inbox entry SDIQT reads.
- **Attacker:** a quantum adversary able to run Shor's algorithm, or validators holding two thirds of the stake.
- **What stops it:** QoreChain's validator consensus keys are Ed25519; transactions carry hybrid signatures with ML-DSA-87, which protects who sent a transaction and leaves the block signatures classical.
- **Residual risk:** a party that forges validator signatures can present a false chain to light clients, and SDIQT reads chain state through a REST endpoint (`api-testnet.qore.host`). SDIQT does not change consensus security.
- **Code:** `config/constants.json` (`chain.rest_url`), `packages/chain/src/client.ts`.

### 10. ML-DSA-44 for user entries

- **Asset:** L2 balances.
- **Attacker:** anyone who can forge an ML-DSA-44 signature.
- **What stops it:** qledger-v1 accepts ML-DSA-44 only (NIST category 2), with the FIPS 204 context `qledger/v1` and the chain and rollup ids in the signed message, so a signature from another rollup or chain fails. In `full` mode the proof checks every signature inside the STARK.
- **Residual risk:** user funds on the rollup sit at category 2, below the category 5 of the operator, tower and receipt keys. Raising it needs a new qledger scheme on the chain side.
- **Code:** `crates/qledger-core/src/tx.rs`, `crates/sdiqt-statement/src/lib.rs` (`SigMode`).

### 11. Posted bytes are public forever

- **Asset:** user privacy.
- **Attacker:** anyone reading the chain or the bundle host, now or later.
- **What stops it:** nothing hides posted data, by design: the inbox, batches, QSTRs and bundles are what make every claim re-checkable. Each transfer and withdrawal reveals its account public key, amount, recipient and nonce. Exit packet envelopes are held by the tower and never posted.
- **Residual risk:** full L2 history and every balance are derivable from public data. A future break of ML-DSA-44 lets an attacker forge new entries for any account whose public key is posted; the record of past entries stays as it is. Bundles and QSTRs name the prover machine label (`prover_id`).
- **Code:** `specs/qstr-v1.md`, `crates/qledger-core/src/tx.rs`, `apps/operator/src/upload.ts`.

### 12. Exit packets

- **Asset:** an offline user's withdrawal and its privacy before release.
- **Attacker:** the tower, whoever holds the tower's ML-KEM-1024 secret, or a network attacker at the tower's API.
- **What stops it:** only the tower can open a packet (ML-KEM-1024). Only the account can replace or cancel its packet (ML-DSA-44 header and cancel signatures, monotonic `seq`). The header is the AEAD's associated data, so a changed header fails to open. At release the tower checks the plaintext is one withdrawal from the header's key at the header's nonce, and drops a stale packet whose nonce the account has moved past; qledger nonces make a replayed withdrawal a no-op. The API returns status only, never the envelope or plaintext. Full rules are in [specs/exit-packet-v1.md](specs/exit-packet-v1.md).
- **Residual risk:** the tower can decline to post, and inclusion still needs a live bonded submitter to batch the inbox. The plaintext is an ordinary signed withdrawal with no height bound of its own, so whoever opens the envelope can post it before `release_height`. The tower learns the amount and recipient at release, and anyone who knows an account id can read its packet status, `seq` and release height from the API. A packet goes stale after any later nonce change, so the user re-seals after every action. A user who needs a second path seals the same withdrawal to more than one tower.
- **Code:** `packages/protocol/src/exit.ts`, `apps/operator/src/exit-packet.ts`, `apps/watchtower/src/exits.ts`, `apps/watchtower/src/api.ts`.

## Out of scope

- Bugs in QoreChain, the RDK fraud check or QoreSeal; report those to the QoreChain team (see [SECURITY.md](SECURITY.md)).
- Mainnet value: `sdiqt-1` runs on the `qorechain-diana` testnet.
