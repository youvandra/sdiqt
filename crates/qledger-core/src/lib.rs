//! qledger-v1 execution core for SDIQT.
//!
//! `smt.rs`, `exec.rs` and `tx.rs` are taken from the QoreChain RDK Rust
//! package (`qorechain-rdk` 0.9.0, Apache-2.0) with the network client,
//! fraud-proof and key-generation parts removed so the code builds inside a
//! zkVM guest.

use sha3::digest::{ExtendableOutput, Update, XofReader};
use thiserror::Error;

pub mod exec;
pub mod inbox;
pub mod smt;
pub mod tx;

pub use exec::*;
pub use inbox::*;
pub use smt::*;
pub use tx::*;

/// A qledger-v1 error.
#[derive(Debug, Clone, Error)]
pub enum QledgerError {
    /// An argument was not usable.
    #[error("qledger: {0}")]
    InvalidInput(String),
    /// Execution touched an account a partial tree does not hold.
    #[error("qledger: the witness does not open an account the batch touches")]
    IncompleteWitness,
    /// A witness does not match the state root, or two witnesses disagree.
    #[error("qledger: witness does not match the state root")]
    BadWitness,
}

/// QoreChain's default hash: SHAKE-256 with a 32-byte output.
pub fn qorehash(parts: &[&[u8]]) -> [u8; 32] {
    let mut h = sha3::Shake256::default();
    for p in parts {
        h.update(p);
    }
    let mut out = [0u8; 32];
    h.finalize_xof().read(&mut out);
    out
}

/// The inbox accumulator after `entries`, starting from `acc_from` (empty for
/// the empty inbox) at sequence `from` (RDK `qledger_accumulate`).
pub fn qledger_accumulate(
    chain_id: &str,
    rollup_id: &str,
    from: u64,
    acc_from: &[u8],
    entries: &[QledgerEntry],
) -> Vec<u8> {
    let mut acc = acc_from.to_vec();
    for (i, e) in entries.iter().enumerate() {
        let data_hash = posted_data_hash(&e.payload);
        acc = inbox_accumulate(&InboxAccumulateInput {
            chain_id,
            rollup_id,
            prev_acc: &acc,
            sequence: from + i as u64 + 1,
            height: e.height,
            poster: &e.poster,
            data_hash: &data_hash,
        })
        .to_vec();
    }
    acc
}
