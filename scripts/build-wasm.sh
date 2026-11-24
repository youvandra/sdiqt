#!/bin/sh
# Rebuild the wasm verifier used by @sdiqt/verify (Node) and the explorer (web).
# Needs the wasm32-unknown-unknown target and wasm-bindgen-cli 0.2.100.
set -eu
cd "$(dirname "$0")/.."
cargo build -p sdiqt-verify --lib --release --target wasm32-unknown-unknown --features wasm
wasm=target/wasm32-unknown-unknown/release/sdiqt_verify.wasm
out=packages/verify/wasm
wasm-bindgen --target nodejs --out-dir "$out/node" "$wasm"
wasm-bindgen --target web --out-dir "$out/web" "$wasm"
# The nodejs build is CommonJS inside an ES module package.
printf '{ "type": "commonjs" }\n' > "$out/node/package.json"
shasum -a 256 "$out"/node/sdiqt_verify_bg.wasm "$out"/web/sdiqt_verify_bg.wasm
