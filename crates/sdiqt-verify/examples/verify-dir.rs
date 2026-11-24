//! Verify the first chunk proof in a directory written by `sdiqt-prove --out`,
//! then the same proof with one byte flipped:
//!   cargo run --release -p sdiqt-verify --example verify-dir -- <dir>
use std::time::Instant;

fn main() {
    let dir = std::path::PathBuf::from(std::env::args().nth(1).expect("usage: verify-dir <dir>"));
    let read = |name: &str| std::fs::read(dir.join(name)).expect(name);
    let (proof, pv, vkey) = (
        read("chunk-0.proof.bin"),
        read("chunk-0.pv.bin"),
        read("vkey-hash.bin"),
    );

    let check = |label: &str, p: &[u8]| {
        let t = Instant::now();
        match sdiqt_verify::verify_chunk(p, &pv, &vkey) {
            Ok(()) => println!("{label}: VALID in {:.1?}", t.elapsed()),
            Err(e) => println!("{label}: INVALID in {:.1?} ({e})", t.elapsed()),
        }
    };
    check("original", &proof);
    let mut flipped = proof.clone();
    let mid = flipped.len() / 2;
    flipped[mid] ^= 1;
    check("one byte flipped", &flipped);
}
