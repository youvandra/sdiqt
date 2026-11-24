//! Chunked statements over the RDK golden batch (`vectors/qledger-v328.json`):
//! every chunk size links back to the chain's batch, and broken chains are refused.

use qledger_core::*;
use sdiqt_statement::*;
use serde_json::Value;

fn q() -> Value {
    let v: Value =
        serde_json::from_str(include_str!("../../../vectors/qledger-v328.json")).unwrap();
    v["qledger"].clone()
}
fn unhex(v: &Value) -> Vec<u8> {
    hex::decode(v.as_str().unwrap()).unwrap()
}
fn entries(q: &Value) -> Vec<QledgerEntry> {
    q["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| QledgerEntry {
            height: e["height"].as_u64().unwrap(),
            poster: e["poster"].as_str().unwrap().to_string(),
            payload: unhex(&e["payload"]),
        })
        .collect()
}

#[test]
fn chunks_of_every_size_link_to_the_chains_batch() {
    let q = q();
    let (c, r) = (
        q["chainId"].as_str().unwrap(),
        q["rollupId"].as_str().unwrap(),
    );
    let es = entries(&q);
    let b = &q["batch"];
    let parent = QledgerLedger::new();
    for mode in [SigMode::Full, SigMode::V0] {
        for size in 1..=es.len() {
            let ins = build_chunks(
                c,
                r,
                &parent,
                b["inboxStart"].as_u64().unwrap(),
                unhex(&b["accFrom"]),
                &es,
                size,
                mode,
            );
            let outs: Vec<_> = ins.iter().map(run_chunk).collect();
            let claim = link_chunks(&parent.root(), &outs).unwrap();
            assert_eq!(
                hex::encode(claim.state_root),
                b["stateRoot"].as_str().unwrap(),
                "size {size}"
            );
            assert_eq!(
                hex::encode(&claim.withdrawals_root),
                b["withdrawalsRoot"].as_str().unwrap(),
                "size {size}"
            );
            assert_eq!(
                hex::encode(claim.data_hash),
                b["dataHash"].as_str().unwrap(),
                "size {size}"
            );
            assert_eq!(claim.inbox_end, b["inboxEnd"].as_u64().unwrap());
        }
    }
}

#[test]
fn broken_chains_are_refused() {
    let q = q();
    let (c, r) = (
        q["chainId"].as_str().unwrap(),
        q["rollupId"].as_str().unwrap(),
    );
    let es = entries(&q);
    let b = &q["batch"];
    let parent = QledgerLedger::new();
    let ins = build_chunks(
        c,
        r,
        &parent,
        b["inboxStart"].as_u64().unwrap(),
        unhex(&b["accFrom"]),
        &es,
        4,
        SigMode::V0,
    );
    let outs: Vec<_> = ins.iter().map(run_chunk).collect();
    assert_eq!(outs.len(), 3);
    let root = parent.root();
    assert!(link_chunks(&root, &[]).is_err());
    assert!(link_chunks(&[9u8; 32], &outs).is_err(), "wrong parent");
    let swapped = vec![outs[0].clone(), outs[2].clone(), outs[1].clone()];
    assert!(link_chunks(&root, &swapped).is_err(), "reordered");
    let skipped = vec![outs[0].clone(), outs[2].clone()];
    assert!(link_chunks(&root, &skipped).is_err(), "chunk dropped");
    let mut bad = outs.clone();
    bad[1].acc_from[0] ^= 1;
    assert!(link_chunks(&root, &bad).is_err(), "inbox gap");
    // A short prefix links but claims a different batch than the chain's.
    let prefix = link_chunks(&root, &outs[..2]).unwrap();
    assert_ne!(
        hex::encode(prefix.data_hash),
        b["dataHash"].as_str().unwrap()
    );
}
