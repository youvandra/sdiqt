# Red team

One reproducible case per attack on SDIQT. Each case starts from an honest input that the real
code accepts (the control), then feeds it tampered versions and records the refusal. Everything
runs offline from committed fixtures in a few seconds; nothing touches a chain or a host.

```sh
pnpm install --frozen-lockfile
node redteam/run.ts            # print one line per attempt and write redteam/RESULTS.md
node redteam/run.ts --check    # same run; fails if any attempt is accepted or RESULTS.md is stale
```

`pnpm test` runs the `--check` form, so the `node` CI job runs the suite on every pull request.
[`RESULTS.md`](RESULTS.md) is generated and deterministic: it holds the fixture hashes, the
expected refusal for every attempt and the verifier's actual message. The wall time is printed
to the console only.

## Cases

| # | Attack | Code under test | Refused by |
| --- | --- | --- | --- |
| 1 | Tampered bundle: a bit flipped in a proof chunk, with and without the manifest rehashed, plus a 64-offset sweep | `crates/sdiqt-verify` through `@sdiqt/verify` (wasm) | proof file hash, then the SP1 STARK verifier |
| 2 | Swapped chunk: a chunk from another batch, and chunks of one batch in the wrong positions | same | STARK under the pinned program; `link_chunks` |
| 3 | Wrong verifying key hash: pin mismatch, relabelled manifest, untrusted all-zero key | same | pinned key check; STARK vkey check |
| 4 | Replayed QSTR: the golden commitment replayed or relabelled for rdk batch 1, and a valid QSTR replayed for another submission of the same index | `qstrVsManifest`, `manifestVsBatch` (the watchtower's proof step) | field match against the bundle and the chain batch |
| 5 | Forged receipt: flipped signature byte, edited body, attacker key, wrong context | `verifyDocument` (ML-DSA-87, `sdiqt/receipt/v1`) | signature check under the issuer's registered key |
| 6 | Stale exit packet: nonce already used, packet replayed after posting, seq raised | `ExitDesk` with `sealExitPacket` (QoreSeal) | nonce check at release; seq check; header signature |

A case passes only when the control is accepted and each attempt is refused with the expected
reason. An accepted attempt prints `NOT REFUSED` and fails the run.

## Fixtures

- `vectors/bundles/golden-v328` and `vectors/bundles/rdk-v328-e2e/batch-1-FACE91C06DA7`: the
  committed proof bundles, used in place. The rdk bundle was proven with the program the live
  rollup `sdiqt-1` runs (`db524751...`).
- `vectors/qstr/golden-v328.hex` and `vectors/archive/rdk-v328-e2e-mwd5v89d/batches.jsonl`: the
  golden QSTR and the archived chain batches, including two submissions at batch index 1.
- `fixtures/receipt-batch-3.json`: the live receipt from `GET https://sdiqt.xyz/api/receipts/3`.
- `fixtures/tower-key.json`: the ML-DSA-87 key QoreChain registered for the receipt issuer, from
  `GET https://api-testnet.qore.host/qorechain/pqc/v1/account/<issuer>`, decoded to hex.

Exit packets are sealed fresh on each run to a throwaway ML-KEM key, so their bytes change while
every status and reason stays the same.
