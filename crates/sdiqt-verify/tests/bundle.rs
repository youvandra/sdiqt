//! The golden bundle (`vectors/bundles/golden-v328`: the RDK golden batch proved
//! as three compressed chunk proofs) verifies, and every tampering is refused.

use std::path::{Path, PathBuf};

use sdiqt_verify::bundle::{proof_root, sha256, Manifest};
use sdiqt_verify::{verify_bundle, VerifyError};

fn dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vectors/bundles/golden-v328")
}

fn load() -> (Manifest, Vec<Vec<u8>>) {
    let m = Manifest::read(&dir()).expect("golden manifest reads");
    let proofs = m
        .chunks
        .iter()
        .map(|c| std::fs::read(dir().join(&c.file)).expect("chunk file"))
        .collect();
    (m, proofs)
}

/// Rewrite indexes, hashes and the proof root after a change to the chunk list,
/// so only the property under test is wrong.
fn reseal(m: &mut Manifest, proofs: &[Vec<u8>]) {
    let hashes: Vec<[u8; 32]> = proofs.iter().map(|p| sha256(p)).collect();
    for (i, (c, h)) in m.chunks.iter_mut().zip(&hashes).enumerate() {
        c.index = i.to_string();
        c.proof_sha256 = hex::encode(h);
    }
    m.proof_root = hex::encode(proof_root(&hashes));
}

fn golden_batch() -> serde_json::Value {
    let v: serde_json::Value =
        serde_json::from_str(include_str!("../../../vectors/qledger-v328.json")).unwrap();
    v["qledger"]["batch"].clone()
}

#[test]
fn golden_bundle_is_valid_and_matches_the_chain_batch() {
    let (m, proofs) = load();
    let claim = verify_bundle(&m, &proofs, Some(&m.program_vkey_hash)).expect("valid");
    let b = golden_batch();
    assert_eq!(claim.chunks, 3);
    assert_eq!(
        hex::encode(claim.state_root),
        b["stateRoot"].as_str().unwrap()
    );
    assert_eq!(
        hex::encode(&claim.withdrawals_root),
        b["withdrawalsRoot"].as_str().unwrap()
    );
    assert_eq!(
        hex::encode(claim.data_hash),
        b["dataHash"].as_str().unwrap()
    );
    assert_eq!(claim.inbox_end, b["inboxEnd"].as_u64().unwrap());
}

#[test]
fn another_program_is_refused() {
    let (m, proofs) = load();
    let other = "00".repeat(32);
    assert!(matches!(
        verify_bundle(&m, &proofs, Some(&other)),
        Err(VerifyError::WrongProgram { .. })
    ));
}

#[test]
fn a_manifest_naming_another_vkey_fails_the_proof() {
    let (mut m, proofs) = load();
    let mut vkey = hex::decode(&m.program_vkey_hash).unwrap();
    vkey[0] ^= 1;
    m.program_vkey_hash = hex::encode(vkey);
    assert!(matches!(
        verify_bundle(&m, &proofs, None),
        Err(VerifyError::Proof(0, _))
    ));
}

#[test]
fn a_flipped_byte_is_caught_by_the_file_hash() {
    let (m, mut proofs) = load();
    let mid = proofs[1].len() / 2;
    proofs[1][mid] ^= 1;
    assert!(matches!(
        verify_bundle(&m, &proofs, None),
        Err(VerifyError::ProofHash(1))
    ));
}

#[test]
fn a_flipped_byte_with_matching_hashes_fails_the_proof() {
    let (mut m, mut proofs) = load();
    let mid = proofs[1].len() / 2;
    proofs[1][mid] ^= 1;
    reseal(&mut m, &proofs);
    assert!(matches!(
        verify_bundle(&m, &proofs, None),
        Err(VerifyError::Proof(1, _))
    ));
}

#[test]
fn swapped_chunks_do_not_link() {
    let (mut m, mut proofs) = load();
    m.chunks.swap(1, 2);
    proofs.swap(1, 2);
    reseal(&mut m, &proofs);
    assert!(matches!(
        verify_bundle(&m, &proofs, None),
        Err(VerifyError::Link(_))
    ));
}

#[test]
fn a_dropped_middle_chunk_does_not_link() {
    let (mut m, mut proofs) = load();
    m.chunks.remove(1);
    proofs.remove(1);
    reseal(&mut m, &proofs);
    assert!(matches!(
        verify_bundle(&m, &proofs, None),
        Err(VerifyError::Link(_))
    ));
}

#[test]
fn a_dropped_last_chunk_proves_a_different_batch() {
    let (mut m, mut proofs) = load();
    m.chunks.pop();
    proofs.pop();
    reseal(&mut m, &proofs);
    assert!(matches!(
        verify_bundle(&m, &proofs, None),
        Err(VerifyError::ClaimMismatch(_))
    ));
}

#[test]
fn a_changed_claim_is_refused() {
    let (mut m, proofs) = load();
    m.state_root = "11".repeat(32);
    assert!(matches!(
        verify_bundle(&m, &proofs, None),
        Err(VerifyError::ClaimMismatch("state_root"))
    ));
}

#[test]
fn the_manifest_is_canonical_and_stable() {
    let (m, _) = load();
    let on_disk = std::fs::read(dir().join("manifest.json")).unwrap();
    assert_eq!(m.canonical_bytes(), on_disk);
    let mut pretty = serde_json::to_vec_pretty(&m).unwrap();
    pretty.push(b'\n');
    let tmp = std::env::temp_dir().join(format!("sdiqt-noncanonical-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    std::fs::write(tmp.join("manifest.json"), pretty).unwrap();
    assert!(
        Manifest::read(&tmp).is_err(),
        "pretty-printed manifest is refused"
    );
    std::fs::remove_dir_all(&tmp).unwrap();
}

#[test]
fn the_json_entry_point_takes_joined_proofs() {
    let (m, proofs) = load();
    let json = std::fs::read_to_string(dir().join("manifest.json")).unwrap();
    let joined: Vec<u8> = proofs.concat();
    let lengths: Vec<u32> = proofs.iter().map(|p| p.len() as u32).collect();
    let split = sdiqt_verify::split_proofs(&joined, &lengths).unwrap();
    assert_eq!(split, proofs);
    let claim =
        sdiqt_verify::verify_bundle_json(&json, &split, Some(&m.program_vkey_hash)).unwrap();
    assert_eq!(claim.chunks, proofs.len());
}

#[test]
fn the_json_entry_point_refuses_bad_input() {
    let (_, proofs) = load();
    let json = std::fs::read_to_string(dir().join("manifest.json")).unwrap();
    let joined: Vec<u8> = proofs.concat();
    assert!(sdiqt_verify::split_proofs(&joined, &[1, 2]).is_err());
    let other = json.replace("\"version\":\"1\"", "\"version\":\"2\"");
    assert!(sdiqt_verify::verify_bundle_json(&other, &proofs, None).is_err());
    let extra = json.replacen('{', "{\"extra\":\"x\",", 1);
    assert!(sdiqt_verify::verify_bundle_json(&extra, &proofs, None).is_err());
}
