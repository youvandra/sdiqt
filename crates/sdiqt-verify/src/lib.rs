//! Verify one SDIQT chunk proof: an SP1 compressed STARK over the chunk
//! statement, checked against the program's verifying-key hash and the
//! chunk's public values. Hash-based throughout; no pairing-based wrap.

use sp1_verifier::compressed::{CompressedError, SP1CompressedVerifierRaw};
use thiserror::Error;

/// Why a chunk proof was rejected.
#[derive(Debug, Error)]
pub enum VerifyError {
    #[error("chunk proof rejected: {0}")]
    Proof(#[from] CompressedError),
}

/// Verify a chunk proof.
///
/// * `proof` - bincode of the SDK's `SP1Proof::Compressed`.
/// * `public_values` - the chunk's committed public values.
/// * `vkey_hash` - bincode of the program verifying key's KoalaBear digest.
pub fn verify_chunk(
    proof: &[u8],
    public_values: &[u8],
    vkey_hash: &[u8],
) -> Result<(), VerifyError> {
    SP1CompressedVerifierRaw::verify_with_public_values(proof, public_values, vkey_hash)?;
    Ok(())
}

#[cfg(feature = "wasm")]
mod wasm {
    use wasm_bindgen::prelude::*;

    /// Browser and Node entry point. Resolves on a valid proof and throws the
    /// rejection reason otherwise.
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
