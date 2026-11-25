# Exit packet v1

An exit packet is a qledger withdrawal that a user signs now and hands to the SDIQT watchtower sealed, so the withdrawal reaches the rollup inbox at a chosen height even if the user is offline then. The tower holds no bond and cannot batch: inclusion still needs a live bonded submitter (the operator or anyone else) to batch the inbox in based order.

Reference implementation: `packages/protocol/src/exit.ts` (formats), `apps/operator/src/exit-packet.ts` (seal, open, cancel), `apps/watchtower/src/exits.ts` (the tower's rules). Tests: `apps/watchtower/test/exits.test.ts`.

## Packet

JSON with three fields:

| Field | Value |
|---|---|
| `header` | see below; sent in clear |
| `header_sig` | ML-DSA-44 signature (hex) of the header's canonical bytes (RFC 8785), context `sdiqt/exit-packet/v1`, by the account's qledger key |
| `envelope` | QoreSeal envelope text (`qoreseal:` + base64url), mode `mlkem`, one recipient: the tower's registered ML-KEM-1024 key; purpose `sdiqt/exit-packet/v1`; AAD = the header's canonical bytes; plaintext = the signed qledger withdrawal exactly as it is posted |

Header fields (all integers are decimal strings):

| Field | Meaning |
|---|---|
| `v` | `"1"` |
| `purpose` | `"sdiqt/exit-packet/v1"` |
| `chain_id`, `rollup_id` | where the withdrawal runs |
| `account` | qledger account id (hex), derived from `public_key` |
| `public_key` | the account's ML-DSA-44 public key (hex) |
| `seq` | packet sequence; a higher seq replaces a lower one |
| `nonce` | nonce of the sealed withdrawal |
| `release_height` | first chain height at which the tower may post |
| `tower` | the tower account the packet is sealed to |
| `tower_kem_sha256` | SHA-256 (hex) of that account's registered ML-KEM-1024 key |

Mode `mlkem` is used because the chain's KEM registry (`MsgRegisterKEMKey`) holds only the ML-KEM-1024 key; the hybrid mode needs an X25519 key from a recipient card.

## Cancel

`{ body, sig }`: `body` = `{ v: "1", purpose: "sdiqt/exit-cancel/v1", chain_id, rollup_id, account, public_key, seq }`, `sig` = ML-DSA-44 signature of its canonical bytes, context `sdiqt/exit-cancel/v1`. It cancels every packet of the account with this seq or lower.

## Tower rules

The tower MUST refuse a packet that is for another chain, rollup, tower or KEM key; whose `account` is not derived from `public_key`; whose header signature does not verify; or whose `seq` is at or below the stored seq or a cancelled seq. It stores one packet per account (the newest).

At each tick, for every stored packet whose `release_height` the chain has reached, the tower opens the envelope with its key and checks that the plaintext is one qledger withdrawal from `public_key`, at `nonce`, with a valid signature for the chain and rollup. Then:

- if the account's nonce after the whole inbox so far differs from `nonce`, the packet is **stale** and dropped (the user acted after sealing; re-seal after every nonce change);
- if opening or a check fails, the packet is **rejected** and dropped;
- otherwise the tower posts the plaintext to the rollup inbox with `MsgPostRollupData` (**posted**).

A failed post is retried up to 3 times. The tower never shows the envelope or plaintext through its API: `GET /api/exits/<account>` returns status, seq, release height, reason and post tx only.

## API

| Route | Body | Result |
|---|---|---|
| `POST /api/exits` | packet | 202 with status, 422 with the refusal reason |
| `POST /api/exits/cancel` | cancel | 200 with status, 422 with the refusal reason |
| `GET /api/exits/<account>` | | status, 404 when none |

Request bodies are limited to 64 KiB; a packet is about 16 kB.

## CLI

```bash
node apps/operator/src/accounts-cli.ts seal-exit --l2-key <seed> --recipient <qor1> --uqor <n> \
  --nonce <n> --seq <n> --release-height <h> --tower <qor1> --out packet.json \
  [--send --tower-url https://sdiqt.xyz]
node apps/operator/src/accounts-cli.ts cancel-exit --l2-key <seed> --seq <n> --out cancel.json \
  [--send --tower-url https://sdiqt.xyz]
```

## Security considerations

- Only the tower can open a packet (ML-KEM-1024); the amount and recipient stay private until the tower posts.
- Only the account can replace or cancel its packet (ML-DSA-44 header and cancel signatures); anyone else's packet for the account is refused at intake.
- A changed header fails the AEAD (it is the AAD); a changed ciphertext fails to open and is rejected without a post.
- A stale packet cannot spend twice: qledger nonces make a replayed or outdated withdrawal a no-op, and the tower drops it before posting.
- The tower learns the withdrawal at release time, and can choose not to post. A user who needs a second path seals the same withdrawal to more than one tower.
