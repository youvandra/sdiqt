//! The spec vectors of `specs/statement-v1.md` and `specs/bundle-v1.md`
//! (`vectors/statement/cases.json`, `vectors/bundles/cases.json`) against the
//! Rust decoder, linker, reader and verifier. The vectors are written by
//! `packages/protocol/scripts/vectors.ts`.

use std::path::{Path, PathBuf};

use sdiqt_statement::{link_chunks, ChunkOutput};
use sdiqt_verify::bundle::Manifest;
use sdiqt_verify::{decode_public_values, sig_mode_name, verify_bundle_json};
use serde_json::{json, Value};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn load(path: &str) -> Value {
    serde_json::from_str(&std::fs::read_to_string(root().join(path)).unwrap()).unwrap()
}

fn s(v: &Value) -> &str {
    v.as_str().expect("a string")
}

fn list(v: &Value) -> &Vec<Value> {
    v.as_array().expect("an array")
}

fn view(c: &ChunkOutput) -> Value {
    json!({
        "chain_id": c.chain_id,
        "rollup_id": c.rollup_id,
        "start_root": hex::encode(c.start_root),
        "end_root": hex::encode(c.end_root),
        "inbox_from": c.inbox_from.to_string(),
        "inbox_to": c.inbox_to.to_string(),
        "acc_from": hex::encode(c.acc_from),
        "acc_to": hex::encode(c.acc_to),
        "withdrawals": c.withdrawals.iter().map(|w| json!({
            "index": w.index.to_string(),
            "recipient": w.recipient,
            "amount": w.amount.to_string(),
        })).collect::<Vec<_>>(),
        "sig_mode": sig_mode_name(c.mode),
        "sig_bits": c.sig_bits,
    })
}

fn chunks(v: &Value) -> Vec<ChunkOutput> {
    list(v)
        .iter()
        .map(|h| decode_public_values(&hex::decode(s(h)).unwrap()).expect("decodes"))
        .collect()
}

fn root32(v: &Value) -> [u8; 32] {
    hex::decode(s(v)).unwrap().try_into().unwrap()
}

#[test]
fn statement_decode_vectors() {
    let cases = load("vectors/statement/cases.json");
    for c in list(&cases["decode"]["valid"]) {
        let out = decode_public_values(&hex::decode(s(&c["public_values"])).unwrap())
            .unwrap_or_else(|e| panic!("{}: {e}", s(&c["name"])));
        assert_eq!(view(&out), c["output"], "{}", s(&c["name"]));
    }
    for c in list(&cases["decode"]["invalid"]) {
        let pv = hex::decode(s(&c["public_values"])).unwrap();
        assert!(
            decode_public_values(&pv).is_err(),
            "{} ({}) decoded",
            s(&c["name"]),
            s(&c["rule"])
        );
    }
}

#[test]
fn statement_link_vectors() {
    let cases = load("vectors/statement/cases.json");
    for c in list(&cases["link"]["valid"]) {
        let claim = link_chunks(&root32(&c["parent_root"]), &chunks(&c["chunks"])).unwrap();
        let got = json!({
            "chain_id": claim.chain_id,
            "rollup_id": claim.rollup_id,
            "parent_root": hex::encode(claim.parent_root),
            "inbox_from": claim.inbox_from.to_string(),
            "inbox_end": claim.inbox_end.to_string(),
            "data_hash": hex::encode(claim.data_hash),
            "state_root": hex::encode(claim.state_root),
            "withdrawals_root": hex::encode(&claim.withdrawals_root),
            "sig_mode": sig_mode_name(claim.mode),
            "chunks": claim.chunks.to_string(),
        });
        assert_eq!(got, c["claim"], "{}", s(&c["name"]));
    }
    for c in list(&cases["link"]["invalid"]) {
        let err = link_chunks(&root32(&c["parent_root"]), &chunks(&c["chunks"]))
            .expect_err(s(&c["name"]));
        assert_eq!(format!("{err:?}"), s(&c["error"]), "{}", s(&c["name"]));
    }
}

fn proofs_for(slots: &Value, files: &[Vec<u8>]) -> Vec<Vec<u8>> {
    list(slots)
        .iter()
        .map(|slot| {
            let mut p = files[slot["from"].as_u64().unwrap() as usize].clone();
            if let Some(at) = slot.get("flip").and_then(Value::as_u64) {
                p[at as usize] ^= 1;
            }
            p
        })
        .collect()
}

#[test]
fn bundle_vectors() {
    let cases = load("vectors/bundles/cases.json");
    let dir = root().join(s(&cases["bundle"]));
    let golden = Manifest::read(&dir).unwrap();
    let files: Vec<Vec<u8>> = golden
        .chunks
        .iter()
        .map(|c| std::fs::read(dir.join(&c.file)).unwrap())
        .collect();

    for c in list(&cases["valid"]) {
        let proofs = proofs_for(&c["proofs"], &files);
        let claim =
            verify_bundle_json(s(&c["manifest"]), &proofs, c["vkey"].as_str()).expect("valid");
        assert_eq!(claim.chunks, proofs.len());
        let m: Manifest = serde_json::from_str(s(&c["manifest"])).unwrap();
        assert_eq!(hex::encode(m.hash()), s(&c["manifest_sha256"]));
        assert_eq!(m.canonical_bytes(), s(&c["manifest"]).as_bytes());
    }

    for c in list(&cases["invalid"]) {
        let name = s(&c["name"]);
        match s(&c["check"]) {
            "verifier" => {
                let proofs = proofs_for(&c["proofs"], &files);
                let err = verify_bundle_json(s(&c["manifest"]), &proofs, c["vkey"].as_str())
                    .expect_err(name);
                let got = format!("{err:?}");
                assert!(got.starts_with(s(&c["error"])), "{name}: {got}");
            }
            "reader" => {
                let tmp =
                    std::env::temp_dir().join(format!("sdiqt-spec-vector-{}", std::process::id()));
                std::fs::create_dir_all(&tmp).unwrap();
                std::fs::write(tmp.join("manifest.json"), s(&c["manifest"])).unwrap();
                let err = Manifest::read(&tmp).expect_err(name);
                std::fs::remove_dir_all(&tmp).unwrap();
                assert!(err.to_string().contains(s(&c["error"])), "{name}: {err}");
            }
            // Checked by packages/verify/test/specs.test.ts.
            "schema" | "chain" => {}
            other => panic!("{name}: unknown check {other}"),
        }
    }
}
