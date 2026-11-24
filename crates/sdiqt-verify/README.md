# sdiqt-verify

Verifies SDIQT chunk proofs: SP1 compressed STARKs over the chunk statement, checked against the
program's verifying-key hash and the chunk's public values. The same code runs natively and as
WebAssembly in Node and browsers.

## Native

```bash
sdiqt-prove --prove --entries 2 --out data/proofs/golden-2   # writes chunk-0.proof.bin, chunk-0.pv.bin, vkey-hash.bin
cargo run --release -p sdiqt-verify --example verify-dir -- data/proofs/golden-2
```

## WebAssembly

```bash
cargo build -p sdiqt-verify --lib --release --target wasm32-unknown-unknown --features wasm
wasm-bindgen --target web --out-dir crates/sdiqt-verify/examples/web/pkg \
  target/wasm32-unknown-unknown/release/sdiqt_verify.wasm
```

`examples/web/index.html` loads `proof/chunk-0.*` and `proof/vkey-hash.bin`, verifies the proof,
flips one byte and verifies again. `examples/node-verify.mjs` does the same from a `--target nodejs`
build.

Measured on 25 Nov 2026 (2-entry golden chunk, Apple M5): native 44 ms, Node wasm 37 ms,
Chromium wasm 35 ms; the flipped proof is rejected in about 15 ms. The wasm module is 1.04 MB.
