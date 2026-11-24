//! Proof bundle v1: a directory with `manifest.json` and one compressed proof
//! file per chunk. The manifest is canonical JSON (RFC 8785 with every integer
//! as a decimal string and bytes as lowercase hex), so its SHA-256 is stable.

use std::collections::BTreeMap;
use std::path::Path;

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Format tag of [`Manifest`].
pub const BUNDLE_FORMAT: &str = "sdiqt-proof-bundle";
/// Version of [`Manifest`].
pub const BUNDLE_VERSION: &str = "1";
/// Name of the manifest inside a bundle directory.
pub const MANIFEST_FILE: &str = "manifest.json";
/// Domain tag of [`proof_root`].
pub const PROOF_ROOT_TAG: &[u8] = b"sdiqt/proofs/v1";

/// Bundle manifest v1.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub format: String,
    pub version: String,
    pub chain_id: String,
    pub rollup_id: String,
    pub batch_index: String,
    pub inbox_from: String,
    pub inbox_end: String,
    pub parent_root: String,
    pub state_root: String,
    pub withdrawals_root: String,
    pub data_hash: String,
    pub sig_mode: String,
    pub sp1_version: String,
    /// Hex of the bincode-encoded verifying-key digest the proofs check against.
    pub program_vkey_hash: String,
    pub proof_root: String,
    pub chunks: Vec<ChunkEntry>,
}

/// One chunk proof in a bundle.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ChunkEntry {
    pub index: String,
    pub file: String,
    pub proof_sha256: String,
    pub public_values: String,
}

/// The file name of chunk `i`.
pub fn chunk_file(i: usize) -> String {
    format!("chunk-{i}.bin")
}

pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    Sha256::digest(bytes).into()
}

/// `SHA-256("sdiqt/proofs/v1" | be16 n | sha256(proof_1) | ... | sha256(proof_n))`.
pub fn proof_root(proof_hashes: &[[u8; 32]]) -> [u8; 32] {
    let n = u16::try_from(proof_hashes.len()).expect("at most 65,535 chunks");
    let mut h = Sha256::new();
    h.update(PROOF_ROOT_TAG);
    h.update(n.to_be_bytes());
    for p in proof_hashes {
        h.update(p);
    }
    h.finalize().into()
}

impl Manifest {
    /// Canonical bytes: keys sorted at every level, no whitespace. Valid RFC 8785
    /// because the manifest holds only strings, arrays and objects of ASCII.
    pub fn canonical_bytes(&self) -> Vec<u8> {
        let value = serde_json::to_value(self).expect("manifest serializes");
        let sorted: BTreeMap<String, serde_json::Value> =
            serde_json::from_value(value).expect("manifest is an object");
        serde_json::to_vec(&sorted).expect("manifest serializes")
    }

    /// SHA-256 of the canonical bytes; the value a QSTR commitment refers to.
    pub fn hash(&self) -> [u8; 32] {
        sha256(&self.canonical_bytes())
    }

    pub fn write(&self, dir: &Path) -> std::io::Result<()> {
        std::fs::write(dir.join(MANIFEST_FILE), self.canonical_bytes())
    }

    pub fn read(dir: &Path) -> Result<Self, BundleError> {
        let bytes = std::fs::read(dir.join(MANIFEST_FILE))
            .map_err(|e| BundleError::Io(MANIFEST_FILE.into(), e.to_string()))?;
        let m: Manifest =
            serde_json::from_slice(&bytes).map_err(|e| BundleError::Manifest(e.to_string()))?;
        if m.format != BUNDLE_FORMAT || m.version != BUNDLE_VERSION {
            return Err(BundleError::Manifest(format!(
                "expected {BUNDLE_FORMAT} v{BUNDLE_VERSION}, got {} v{}",
                m.format, m.version
            )));
        }
        if m.canonical_bytes() != bytes {
            return Err(BundleError::Manifest(
                "manifest is not in canonical form".into(),
            ));
        }
        Ok(m)
    }
}

/// Why a bundle cannot be read.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum BundleError {
    #[error("bundle: cannot read {0}: {1}")]
    Io(String, String),
    #[error("bundle manifest: {0}")]
    Manifest(String),
}
