# @sdiqt/operator

The SDIQT sequencer. Each tick it catches the archive (`@sdiqt/archiver`) up,
re-executes every batch the chain received since the last tick, and, when the
batch trigger fires (one pending entry that is not our own commitment and 20
idle blocks, or 64 pending entries), plans the next batch from the archive.

Before any submit the plan passes a dual self-check: the RDK TS fraud check
(`buildQledgerFraudProof` + `checkQledgerFraud`) and the Rust statement
(`sdiqt-prove claim`) must both accept the exact roots about to be sent. Any
disagreement, error or missing answer refuses the batch and logs an alert.

```bash
cargo build --release -p sdiqt-prover
node apps/operator/src/cli.ts history --rollup <id>          # check every archived batch
node apps/operator/src/cli.ts shadow --rollup <id> --duration 3600
SDIQT_LIVE=yes node apps/operator/src/cli.ts live --mnemonic-file secrets/operator.txt
```

`shadow` never signs. `live` submits anchored (`anchor: "require"`) through the
simulate-first `SafeTx` with a daily spend cap. Write `pause` or `drain` to the
control file (default `data/operator/control`) to stop planning or to batch
everything pending now. Logs are JSON lines under `data/operator/`.

When another bonded submitter batches the inbox first, the operator checks that
batch like any other and plans from the new consumed position.
