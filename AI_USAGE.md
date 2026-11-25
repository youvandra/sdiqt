# AI usage

SDIQT was built with Claude Code (Anthropic's coding agent, Claude models) as the main pair programmer. The team chose the idea, the scope and the design, approved every on-chain spend and merged every pull request. This file says which parts the agent wrote, how the work was steered and how its output was checked.

The product itself calls no AI model. The operator, prover, watchtower, verifier and explorer are deterministic code.

## What the agent wrote

| Area | Agent's part | Team's part |
|---|---|---|
| Rust proof stack (`crates/`) | Port of qledger-v1 execution from the RDK, chunk statement, SP1 guest, prover CLI, verifier and its WebAssembly build | Choice of SP1 and a hash-based STARK, chunk limits from the measured calibration, the statement's public values |
| Operator, watchtower, archiver (`apps/`) | Batching, prove queue, QSTR posts, receipts, challenge path, exit desk, API | Trust model, who holds which key, spend limits, when each live step ran |
| Formats (`specs/`, `packages/protocol`) | Encoders, decoders, zod schemas, spec text, test vectors | The QSTR layout, the exit packet design and the receipt fields |
| Explorer (`apps/explorer`) | React components, browser verify, Playwright demo path | Page structure, the design source, every visual review at desktop and phone width |
| Docs | Drafts of the README, specs, PROOF.md generator and this file | Facts, wording rules and final review |

## How the work was steered

- **Plan with done-conditions.** Work followed a written plan where each task names its output and a check the agent can run, such as a test, a CLI result or a chain query. A task counted as done only with that evidence shown.
- **One change per pull request.** Each change landed as its own pull request with a Conventional Commit title. CI runs Rust format, clippy and tests, TypeScript type checks and tests, Biome, the hygiene guard and an end-to-end run of the explorer against sdiqt.xyz. Each pull request merged only after the team said yes.
- **Spend gates.** Chain transactions simulate by default. Sending needs `SDIQT_LIVE=yes`, a `--cap-qor` limit and a daily spend cap in [`packages/chain/src/spend-cap.ts`](packages/chain/src/spend-cap.ts). The agent proposed each live step with its amount and the account balance and sent it only after the team said yes in chat.
- **Wording guard.** [`scripts/check-hygiene.mjs`](scripts/check-hygiene.mjs) blocks claims the project does not make (for example that the chain checks the STARK), private files and em dashes in tracked text on every pull request.
- **Agent config stays local.** Agent instruction files are kept out of the repository.

## How the output was checked

- **Against the chain.** The guest's roots are compared with real batch records: the RDK golden vectors in CI, a batch of another team's rollup (`vectors/bundles/rdk-v328-e2e`), and every batch of `sdiqt-1`. [`scripts/proof.mjs`](scripts/proof.mjs) recomputes every number in [PROOF.md](PROOF.md) from chain, and `--check` fails on any difference.
- **By running the real path.** Each live step was run on the diana testnet and read back from chain before it was written down: rollup creation, deposits, transfers, four proven batches and the paid withdrawal.
- **By measurement.** Prover limits come from measured runs on the prover machine ([`docs/prover-calibration.md`](docs/prover-calibration.md)); an estimate is marked as a projection.
- **By review.** The team reviewed pull requests and asked for fixes before merging.

## Mistakes caught on the way

The agent's first versions were wrong in places. These were found by the checks above and fixed in their own commits:

- QSTR encoded an empty withdrawals root differently from the chain; fixed to 32 zero bytes and the spec updated (`fix(protocol)`, #40).
- The prove queue lost saved jobs after a restart, which delayed the first three proofs; fixed to resume them (`fix(operator)`, #41).
- The archiver reported a lagging chain tx index as an accumulator mismatch; fixed to report the two apart (`fix(archiver)`, #24).
- A review of the challenge path found a restart case that skipped a send, a failed proof build that stopped the tick, and a spend reservation kept after a failed tx; all fixed before merge (#33).
- The explorer's automatic verify was aborted by a double mount in development; found while testing the Verify Latest Batch button and fixed before merge (#37).
