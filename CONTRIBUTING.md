# Contributing

## Setup

- Rust stable (see `rust-toolchain.toml`) and Node.js 22.18 or newer with pnpm 10.
- The SP1 guest and prover need the [SP1 toolchain](https://docs.succinct.xyz/docs/sp1/getting-started/install)
  (`sp1up`) and `protoc`. Host crates and the TypeScript packages build without them.

```bash
pnpm install
git config core.hooksPath .githooks
cargo test --release
pnpm typecheck && pnpm test
```

## Pull requests

- Branch from `main`; every change lands through a pull request with green checks.
- The PR title is a [Conventional Commit](https://www.conventionalcommits.org/) subject
  (`feat: ...`, `fix(verify): ...`). It becomes the squash commit on `main`.
- Keep a pull request to one change. Update docs and tests in the same pull request.
- `node scripts/check-hygiene.mjs` must pass: it blocks private files, overclaiming wording
  and em-dashes in tracked text.

## Style

- Rust: `cargo fmt`, `cargo clippy -- -D warnings`.
- TypeScript: Biome (`pnpm lint`), strict compiler options from `tsconfig.base.json`.
- UI labels use Title Case; headings use sentence case.
