# Prover calibration

Measured on 25 Nov 2026 on the prover machine (Apple M5, 10 cores, 16 GB), SP1 6.10.0 CPU
prover, compressed STARKs, signatures checked inside the proof (`full` mode). Inputs are prefixes
of the RDK golden batch (`vectors/qledger-v328.json`).

## Cycles per entry

Execute mode, whole prefix in one chunk:

| Entries | Cycles | Added by the last entry | Last entry |
| --- | --- | --- | --- |
| 1 | 696,231 | 696,231 | deposit, plus fixed cost |
| 2 | 2,650,292 | 1,954,061 | transfer opening a new account |
| 4 | 5,630,131 | 1,004,676 | transfer between existing accounts |
| 6 | 8,272,508 | 1,628,926 | transfer opening a new account |
| 9 | 11,613,353 | 1,016,162 | transfer between existing accounts |
| 10 | 11,618,953 | 5,600 | entry that does not decode (no-op) |
| 11 | 11,625,751 | 6,798 | deposit to an existing account |

A signed transfer costs about 1.0M cycles, or about 2.0M when it opens a new account. ML-DSA-44
verification is most of that. No-op entries (including SDIQT's own commitment posts) and deposits
cost a few thousand cycles.

## Proving one chunk

| Entries | Cycles | Prove | Verify | Proof bytes | Max RSS | Peak footprint |
| --- | --- | --- | --- | --- | --- | --- |
| 2 | 2.65M | 114-126 s | 33 ms | 1,272,546 | 10.3 GB | |
| 4 | 5.63M | 145-168 s | 30 ms | 1,272,846 | 10.3 GB | |
| 4 | 6.06M | 192 s | 31 ms | 1,272,846 | 10.8 GB | |
| 6 | 8.27M | 371 s | 62 ms | 1,272,912 | 9.8 GB | 46 GB (compressed memory) |
| 11 | 11.6M | fails during compression | | | | |

## Limits used by the prover

From `config/constants.json`:

- `chunk_max_signed_entries = 4` and `chunk_max_cycles = 6,100,000`: the largest chunks that
  proved without memory pressure. Six entries prove, but 2.2 times slower than four, with heavy
  swapping.
- A 64-entry batch therefore needs 16 chunks, about 45-48 minutes on one machine, inside
  `proof_deadline_s = 3,300` (55 minutes) of the 60-minute challenge window when the machine
  runs nothing else.
