//! Batch inputs built from a real archive (`rdk-v328-e2e-mwd5v89d` on
//! qorechain-diana): every batch the chain kept matches the host claim, and
//! the two batches the chain rolled back (a flipped state root, a forged
//! withdrawals root) are the only ones that differ.

use sdiqt_statement::archive::{
    batch_input_from_archive, claim_mismatches, ArchiveBatch, ArchiveEntry,
};
use sdiqt_statement::{link_chunks, run_chunk, ChunkOutput, SigMode};

const DIR: &str = "../../vectors/archive/rdk-v328-e2e-mwd5v89d";
const ROLLUP: &str = "rdk-v328-e2e-mwd5v89d";
const CHAIN: &str = "qorechain-diana";

fn lines<T: serde::de::DeserializeOwned>(file: &str) -> Vec<T> {
    std::fs::read_to_string(format!("{DIR}/{file}"))
        .unwrap()
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect()
}

fn mismatches(entries: &[ArchiveEntry], b: &ArchiveBatch) -> Vec<String> {
    let input = batch_input_from_archive(CHAIN, ROLLUP, entries, b).unwrap();
    let (parent, chunks) = input.chunk_inputs(4, SigMode::Full).unwrap();
    let outputs: Vec<ChunkOutput> = chunks.iter().map(run_chunk).collect();
    claim_mismatches(&link_chunks(&parent.root(), &outputs).unwrap(), b)
}

#[test]
fn kept_batches_match_and_rolled_back_batches_differ() {
    let entries: Vec<ArchiveEntry> = lines("inbox.jsonl");
    let batches: Vec<ArchiveBatch> = lines("batches.jsonl");
    assert_eq!((entries.len(), batches.len()), (18, 9));
    let differing: Vec<&str> = batches
        .iter()
        .filter(|b| !mismatches(&entries, b).is_empty())
        .map(|b| &b.txhash[..8])
        .collect();
    assert_eq!(differing, ["B30CD12C", "3BC15BD0"]);
}

#[test]
fn tampered_payload_is_refused() {
    let mut entries: Vec<ArchiveEntry> = lines("inbox.jsonl");
    let batches: Vec<ArchiveBatch> = lines("batches.jsonl");
    let p = &mut entries[2].payload;
    let flipped = if p.ends_with('0') { '1' } else { '0' };
    p.pop();
    p.push(flipped);
    assert!(batch_input_from_archive(CHAIN, ROLLUP, &entries, &batches[0]).is_err());
}

#[test]
fn short_archive_is_refused() {
    let entries: Vec<ArchiveEntry> = lines("inbox.jsonl");
    let batches: Vec<ArchiveBatch> = lines("batches.jsonl");
    let last = batches.last().unwrap();
    assert!(batch_input_from_archive(CHAIN, ROLLUP, &entries[..10], last).is_err());
}
