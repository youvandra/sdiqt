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

## Releases

[release-please](https://github.com/googleapis/release-please) cuts releases from the
Conventional Commit subjects on `main`. The repository carries one version: tag `vX.Y.Z`
covers every crate and package, and `.release-please-manifest.json` holds the last released
version.

1. Each push to `main` updates one open pull request titled `chore: release X.Y.Z`. It sets
   the version in every `package.json`, crate `Cargo.toml` and `Cargo.lock`, and adds the
   release section to `CHANGELOG.md`. Below 1.0.0, `fix` bumps the patch version, and `feat`
   or a breaking change bumps the minor version.
2. The maintainer merges it like any other pull request: squash merge, green checks, title
   unchanged.
3. The merge creates a draft release and its tag. The `bundles` job in
   `.github/workflows/release.yml` downloads the proof bundle of every proven batch in
   `PROOF.md` from https://sdiqt.xyz/bundles, checks each manifest's SHA-256 against
   `PROOF.md` and each chunk against its manifest, attaches
   `sdiqt-proof-bundles-vX.Y.Z.tar.gz` with its checksums, and publishes the release. A failed
   check leaves the release as a draft.

Regenerate `PROOF.md` with `node scripts/proof.mjs` before merging the release pull request,
so the release carries the current bundles. `node scripts/release-bundles.mjs` runs the same
download and hash checks locally and writes nothing.

Changelog lines come from PR titles. To reword one after the merge, add this block to the
merged pull request's description:

```text
BEGIN_COMMIT_OVERRIDE
feat: the reworded subject
END_COMMIT_OVERRIDE
```

### Checks on the release pull request

GitHub starts no workflows for a pull request opened with the default `GITHUB_TOKEN`, so the
required checks stay pending on the release pull request. Two ways to run them:

- Add a repository secret `RELEASE_PLEASE_TOKEN`: a GitHub App token or a fine-grained token
  for this repository with read and write access to Contents, Pull requests and Issues. The
  workflow uses it when present, and the checks then run on every update.
- Without that secret, turn on "Allow GitHub Actions to create and approve pull requests"
  (Settings, Actions, General), then close and reopen the release pull request right before
  merging so the checks run under your account. The ruleset requires the branch to be up to
  date with `main`, so repeat this after each update of the release pull request.

## Style

- Rust: `cargo fmt`, `cargo clippy -- -D warnings`.
- TypeScript: Biome (`pnpm lint`), strict compiler options from `tsconfig.base.json`.
- UI labels use Title Case; headings use sentence case.
