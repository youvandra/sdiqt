//! Verify SDIQT proofs. A chunk proof is an SP1 compressed STARK over the
//! chunk statement, checked against the program's verifying-key hash and the
//! chunk's public values; a bundle is the chunk proofs of one batch, which
//! must link into exactly the batch claimed by its manifest. Hash-based
//! throughout; no pairing-based wrap.

pub mod bundle;

use sdiqt_statement::{link_chunks, BatchClaim, ChunkOutput, SigMode};
use sp1_verifier::compressed::{CompressedError, SP1CompressedVerifierRaw};
use thiserror::Error;

use bundle::{proof_root, sha256, Manifest};

/// Why a proof or bundle was rejected.
#[derive(Debug, Error)]
pub enum VerifyError {
    #[error("chunk {0} proof rejected: {1}")]
    Proof(usize, CompressedError),
    #[error("chunk {0}: proof file hash does not match the manifest")]
    ProofHash(usize),
    #[error("chunk {0}: public values do not decode: {1}")]
    PublicValues(usize, String),
    #[error("chunk {0}: index is {1}, expected {0}")]
    ChunkOrder(usize, String),
    #[error("manifest field {0}: {1}")]
    Field(&'static str, String),
    #[error("program verifying key {got} is not the expected {want}")]
    WrongProgram { got: String, want: String },
    #[error("proof root does not match the chunk proofs")]
    ProofRoot,
    #[error("chunks do not link: {0:?}")]
    Link(sdiqt_statement::LinkError),
    #[error("linked claim differs from the manifest in {0}")]
    ClaimMismatch(&'static str),
    #[error("manifest lists {0} chunks but {1} proofs were given")]
    ChunkCount(usize, usize),
}

/// Verify one chunk proof.
///
/// * `proof` - bincode of the SDK's `SP1Proof::Compressed`.
/// * `public_values` - the chunk's committed public values.
/// * `vkey_hash` - bincode of the program verifying key's KoalaBear digest.
pub fn verify_chunk(
    proof: &[u8],
    public_values: &[u8],
    vkey_hash: &[u8],
) -> Result<(), CompressedError> {
    SP1CompressedVerifierRaw::verify_with_public_values(proof, public_values, vkey_hash)
}

/// Decode a chunk's public values into its statement output.
pub fn decode_public_values(public_values: &[u8]) -> Result<ChunkOutput, String> {
    bincode::deserialize(public_values).map_err(|e| e.to_string())
}

fn unhex(name: &'static str, v: &str) -> Result<Vec<u8>, VerifyError> {
    if v.chars().any(|c| c.is_ascii_uppercase()) {
        return Err(VerifyError::Field(name, "uppercase hex".into()));
    }
    hex::decode(v).map_err(|e| VerifyError::Field(name, e.to_string()))
}

fn unhex32(name: &'static str, v: &str) -> Result<[u8; 32], VerifyError> {
    unhex(name, v)?
        .try_into()
        .map_err(|_| VerifyError::Field(name, "expected 32 bytes".into()))
}

fn int(name: &'static str, v: &str) -> Result<u64, VerifyError> {
    v.parse().map_err(|_| VerifyError::Field(name, v.into()))
}

/// The display name of a signature mode in manifests.
pub fn sig_mode_name(mode: SigMode) -> &'static str {
    match mode {
        SigMode::Full => "full",
        SigMode::V0 => "v0",
    }
}

/// Verify every chunk of a bundle and check that the chunks link into the
/// batch its manifest claims. `proofs[i]` is the file of chunk `i`.
/// `expected_vkey_hash` pins the program; `None` trusts the manifest's.
pub fn verify_bundle(
    manifest: &Manifest,
    proofs: &[Vec<u8>],
    expected_vkey_hash: Option<&str>,
) -> Result<BatchClaim, VerifyError> {
    if let Some(want) = expected_vkey_hash {
        if want != manifest.program_vkey_hash {
            return Err(VerifyError::WrongProgram {
                got: manifest.program_vkey_hash.clone(),
                want: want.to_string(),
            });
        }
    }
    if manifest.chunks.len() != proofs.len() {
        return Err(VerifyError::ChunkCount(manifest.chunks.len(), proofs.len()));
    }
    let vkey = unhex("program_vkey_hash", &manifest.program_vkey_hash)?;

    let mut hashes = Vec::with_capacity(proofs.len());
    let mut outputs = Vec::with_capacity(proofs.len());
    for (i, (entry, proof)) in manifest.chunks.iter().zip(proofs).enumerate() {
        if entry.index != i.to_string() {
            return Err(VerifyError::ChunkOrder(i, entry.index.clone()));
        }
        let hash = sha256(proof);
        if hex::encode(hash) != entry.proof_sha256 {
            return Err(VerifyError::ProofHash(i));
        }
        let pv = unhex("public_values", &entry.public_values)?;
        verify_chunk(proof, &pv, &vkey).map_err(|e| VerifyError::Proof(i, e))?;
        outputs.push(decode_public_values(&pv).map_err(|e| VerifyError::PublicValues(i, e))?);
        hashes.push(hash);
    }

    if hex::encode(proof_root(&hashes)) != manifest.proof_root {
        return Err(VerifyError::ProofRoot);
    }

    let parent = unhex32("parent_root", &manifest.parent_root)?;
    let claim = link_chunks(&parent, &outputs).map_err(VerifyError::Link)?;
    check_claim(&claim, manifest)?;
    Ok(claim)
}

/// Compare a linked claim with every batch field of the manifest.
fn check_claim(claim: &BatchClaim, m: &Manifest) -> Result<(), VerifyError> {
    let checks: [(&'static str, bool); 8] = [
        ("chain_id", claim.chain_id == m.chain_id),
        ("rollup_id", claim.rollup_id == m.rollup_id),
        (
            "inbox_from",
            claim.inbox_from == int("inbox_from", &m.inbox_from)?,
        ),
        (
            "inbox_end",
            claim.inbox_end == int("inbox_end", &m.inbox_end)?,
        ),
        ("state_root", hex::encode(claim.state_root) == m.state_root),
        (
            "withdrawals_root",
            hex::encode(&claim.withdrawals_root) == m.withdrawals_root,
        ),
        ("data_hash", hex::encode(claim.data_hash) == m.data_hash),
        ("sig_mode", sig_mode_name(claim.mode) == m.sig_mode),
    ];
    match checks.iter().find(|(_, ok)| !ok) {
        Some((field, _)) => Err(VerifyError::ClaimMismatch(field)),
        None => Ok(()),
    }
}

#[cfg(feature = "wasm")]
mod wasm {
    use wasm_bindgen::prelude::*;

    /// Browser and Node entry point for one chunk. Returns on a valid proof
    /// and throws the rejection reason otherwise.
    #[wasm_bindgen(js_name = verifyChunk)]
    pub fn verify_chunk(
        proof: &[u8],
        public_values: &[u8],
        vkey_hash: &[u8],
    ) -> Result<(), JsError> {
        super::verify_chunk(proof, public_values, vkey_hash)
            .map_err(|e| JsError::new(&e.to_string()))
    }
}
