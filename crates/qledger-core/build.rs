//! Writes the empty-subtree table of the qledger-v1 state tree as a constant,
//! so the zkVM guest does not hash 257 levels on every run.
use sha2::{Digest, Sha256};
use std::fmt::Write;

fn main() {
    let mut e = vec![[0u8; 32]; 257];
    let mut h = Sha256::new();
    h.update([0x00]);
    h.update(b"qledger/v1/empty");
    e[0] = h.finalize().into();
    for i in 1..=256 {
        let mut h = Sha256::new();
        h.update([0x01]);
        h.update(e[i - 1]);
        h.update(e[i - 1]);
        e[i] = h.finalize().into();
    }
    let mut s = String::from("static EMPTY: [[u8; 32]; 257] = [\n");
    for x in &e {
        writeln!(s, "    {:?},", x).unwrap();
    }
    s.push_str("];\n");
    let out = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("empty.rs");
    std::fs::write(out, s).unwrap();
    println!("cargo:rerun-if-changed=build.rs");
}
