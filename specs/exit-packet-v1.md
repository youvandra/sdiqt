# Exit packet v1

An exit packet is a qledger withdrawal that a user signs now and hands to the SDIQT watchtower sealed, so the withdrawal reaches the rollup inbox at a chosen height even if the user is offline then. The tower holds no bond and cannot batch: inclusion still needs a live bonded submitter (the operator or anyone else) to batch the inbox in based order.

Reference implementation: `packages/protocol/src/exit.ts` (formats), `apps/operator/src/exit-packet.ts` (seal, open, cancel), `apps/watchtower/src/exits.ts` (the tower's rules). Tests: `apps/watchtower/test/exits.test.ts`.

Vectors: `vectors/exit-packet/cases.json`, written by `apps/watchtower/scripts/exit-vectors.ts` from fixed seeds (account `11` repeated 32 times, tower KEM key `33` repeated 32 times) with deterministic signatures and fixed sealing entropy. JSON Schemas: `vectors/exit-packet/packet.schema.json` and `vectors/exit-packet/cancel.schema.json`, written by `packages/protocol/scripts/vectors.ts`. `apps/watchtower/test/specs.test.ts` replays every case against the tower's exit desk.

## Conventions

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.

Each normative rule has an id such as **EXIT-1.** and at least one invalid vector in `vectors/exit-packet/cases.json` that cites it. Canonical bytes are RFC 8785 JSON, as in every SDIQT format.

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

At intake (`POST /api/exits`):

- **EXIT-1.** The tower MUST refuse a packet that does not match `ExitPacketV1`: an unknown field, another `v` or `purpose`, a non-canonical integer, hex that is not lowercase or an envelope without the `qoreseal:` prefix.
- **EXIT-2.** The tower MUST refuse a packet for another chain or rollup.
- **EXIT-3.** The tower MUST refuse a packet that names another tower account, or a `tower_kem_sha256` other than the SHA-256 of its own registered ML-KEM-1024 key.
- **EXIT-4.** The tower MUST refuse a packet whose `account` is not the qledger account id of `public_key`.
- **EXIT-5.** The tower MUST refuse a packet whose `header_sig` does not verify over the header's canonical bytes with `public_key` under the context `sdiqt/exit-packet/v1`.
- **EXIT-6.** The tower MUST refuse a packet whose `seq` is at or below the stored packet's seq, or at or below a cancelled seq of the account.

It stores one packet per account (the newest).

At cancel (`POST /api/exits/cancel`):

- **EXIT-7.** The tower MUST refuse a cancel that does not match `ExitCancelV1`, is for another chain or rollup, names an `account` other than the id of `public_key`, or whose `sig` does not verify under the context `sdiqt/exit-cancel/v1`.

At each tick, for every held packet:

- **EXIT-8.** The tower MUST NOT open or post a packet before the chain reaches its `release_height`.

Once the chain reaches `release_height`, the tower opens the envelope with its key and checks that the plaintext is one qledger withdrawal from `public_key`, at `nonce`, with a valid signature for the chain and rollup. Then:

- **EXIT-9.** If the account's nonce after the whole inbox so far differs from the withdrawal's nonce, the tower MUST drop the packet as **stale** without posting it (the user acted after sealing; re-seal after every nonce change).
- **EXIT-10.** If opening or a check fails, the tower MUST drop the packet as **rejected** without posting it.

Otherwise the tower posts the plaintext to the rollup inbox with `MsgPostRollupData` (**posted**). The tower opens the packet before it reads the nonce, so a packet that fails to open is rejected even when it is also stale.

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
