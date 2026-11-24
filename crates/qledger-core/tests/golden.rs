//! Golden vectors from the RDK (`v328.json`): the ported execution must hit
//! the chain's roots with the real ML-DSA-44 verifier, both over a full
//! ledger and over a partial tree opened from witnesses (what the guest runs).

use qledger_core::*;
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
fn full_ledger_matches_every_root() {
    let q = q();
    let env = QledgerEnv {
        chain_id: q["chainId"].as_str().unwrap(),
        rollup_id: q["rollupId"].as_str().unwrap(),
        verifier: &MLDSA44_VERIFIER,
    };
    let es = entries(&q);
    let mut led = QledgerLedger::new();
    assert_eq!(hex::encode(led.root()), q["emptyRoot"].as_str().unwrap());
    for (i, e) in es.iter().enumerate() {
        execute_qledger(&env, &mut led, std::slice::from_ref(e)).unwrap();
        assert_eq!(
            hex::encode(led.root()),
            q["entries"][i]["rootAfter"].as_str().unwrap(),
            "entry {i}"
        );
    }
    let res = execute_qledger(&env, &mut QledgerLedger::new(), &es).unwrap();
    assert_eq!(
        hex::encode(res.state_root),
        q["batch"]["stateRoot"].as_str().unwrap()
    );
    assert_eq!(
        hex::encode(&res.withdrawals_root),
        q["batch"]["withdrawalsRoot"].as_str().unwrap()
    );
}

#[test]
fn partial_tree_from_witnesses_matches() {
    let q = q();
    let env = QledgerEnv {
        chain_id: q["chainId"].as_str().unwrap(),
        rollup_id: q["rollupId"].as_str().unwrap(),
        verifier: &MLDSA44_VERIFIER,
    };
    let es = entries(&q);
    // Parent = state after the first two entries; batch = the rest.
    let mut parent = QledgerLedger::new();
    execute_qledger(&env, &mut parent, &es[..2]).unwrap();
    let mut full = parent.clone();
    let want = execute_qledger(&env, &mut full, &es[2..]).unwrap();

    let mut ids: Vec<[u8; 32]> = full.accounts().iter().map(|a| a.0).collect();
    for (id, _, _) in parent.accounts() {
        if !ids.contains(&id) {
            ids.push(id);
        }
    }
    let ws: Vec<QledgerWitness> = ids.iter().map(|id| parent.witness(id)).collect();
    let mut pt = QledgerPartialTree::new(&parent.root(), &ws).unwrap();
    let got = execute_qledger(&env, &mut pt, &es[2..]).unwrap();
    assert_eq!(got, want);
}

#[test]
fn data_hash_matches_the_batch() {
    let q = q();
    let (c, r) = (
        q["chainId"].as_str().unwrap(),
        q["rollupId"].as_str().unwrap(),
    );
    let es = entries(&q);
    let b = &q["batch"];
    let from = b["inboxStart"].as_u64().unwrap();
    let to = b["inboxEnd"].as_u64().unwrap();
    let acc_from = unhex(&b["accFrom"]);
    let acc_to = qledger_accumulate(c, r, from, &acc_from, &es);
    let dh = inbox_range_hash(&InboxRangeInput {
        chain_id: c,
        rollup_id: r,
        from,
        to,
        acc_from: &acc_from,
        acc_to: &acc_to,
    });
    assert_eq!(hex::encode(dh), b["dataHash"].as_str().unwrap());
}
