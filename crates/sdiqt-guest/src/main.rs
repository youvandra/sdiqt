//! SDIQT guest: proves one chunk of a qledger-v1 batch.
#![no_main]
sp1_zkvm::entrypoint!(main);

use sdiqt_statement::{run_chunk, ChunkInput};

pub fn main() {
    println!("cycle-tracker-report-start: read-input");
    let input = sp1_zkvm::io::read::<ChunkInput>();
    println!("cycle-tracker-report-end: read-input");
    println!("cycle-tracker-report-start: run-chunk");
    let out = run_chunk(&input);
    println!("cycle-tracker-report-end: run-chunk");
    println!("cycle-tracker-report-start: commit");
    sp1_zkvm::io::commit(&out);
    println!("cycle-tracker-report-end: commit");
}
