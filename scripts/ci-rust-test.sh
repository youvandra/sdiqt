#!/usr/bin/env bash
# Run host tests for the workspace's default members (the crates that build
# without the SP1 toolchain). An empty member list is a no-op.
set -euo pipefail
if cargo metadata --no-deps --format-version 1 | grep -q '"packages":\[\]'; then
  echo "no crates yet"
  exit 0
fi
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked --release
