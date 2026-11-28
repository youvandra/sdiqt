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

## Measured: 64-entry batch (batch 19, 27 Nov 2026)

Batch 19 of `sdiqt-1` (inbox 38..102, tx `A1F17AB9…`, height 10844226) is the first 64-entry
batch: 63 signed transfers from a load script plus one QSTR post, 16 chunks. Submitted
10:35:18 UTC, proof deadline 11:30:34 UTC.

The prover ran on the same 16 GB Apple M5 that also ran a browser, chat apps, other
projects and a local watchtower. Peak resident memory per
chunk stayed flat at 9.7 GB (no leak), and the process footprint swung between 23 and 37 GB as
pages moved to swap (30.3 of 30.7 GB swap used).

Attempt 1 (16 chunks planned, stopped at chunk 13 when the Mac shut down at 12:00 UTC):

| Chunks | Prove time per chunk | Machine state |
|---|---|---|
| 0-5 | 255, 354, 368, 396, 341, 355 s | browser and chat apps open |
| 6-12 | 366, 368, 355, 364, 375, 462, 495 s | browser and chat apps closed; builds and video renders ran during 6-11 |

Attempt 2 (restart 13:07:50 UTC after boot, from chunk 0): 16 chunks at 383, 263, 243, 239, 264, 262, 273, 258,
279, 302, 274, 268, 270, 233, 263, 268 s (median 266 s, peak resident memory 10.0 GB), 4,341 s
(72 minutes) of proving in total. Proven 14:21:02 UTC. The proving alone runs about 1,060 s past the
deadline; the receipt latency of 13,513 s after submit also counts the shutdown and restart.
Batch 20 (1 entry, queued behind batch 19) proved in 186 s and landed 14:24:33 UTC.

Each 4-entry chunk took 233 to 495 s here against 145 to 192 s idle, 1.4 to 2.6x slower, and the
batch missed the 3,300 s deadline. Sustained throughput on this machine was 64 entries in 4,341 s,
about 53 entries per hour against 86 idle. A late proof triggers no challenge: settlement stays
optimistic, and the watchtower receipt reads unproven from the deadline until the proof lands.
64-entry batches need a dedicated prover with 32 GB or more, or a machine running nothing else.
