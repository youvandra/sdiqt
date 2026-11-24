# @sdiqt/archiver

Canonical archive of a qledger rollup's inbox and batches. The chain keeps the
inbox accumulator only at retained posts and its tx index reaches back about 29
days, so the prover input builder reads entries from here.

```bash
pnpm --filter @sdiqt/archiver archive -- --rollup sdiqt-1 --out data/archive --watch 30
```

Output in `<out>/<rollup>/`:

- `inbox.jsonl`: one line per inbox entry (`post` or `deposit`), sorted by
  sequence, with the height, tx hash, poster, `data_hash` and payload (base64).
- `batches.jsonl`: one line per `MsgSubmitBatch`, sorted by height, with roots
  as hex. A rolled-back batch and its replacement share a `batch_index` and
  both stay in the file.

Each run re-reads from the highest archived height, merges, replays the inbox
accumulator from empty and checks it against the chain head, then writes both
files atomically. Two runs over the same history give identical files.
