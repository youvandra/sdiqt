//! Prover input v1: one batch as JSON, self-contained.
//!
//! The parent state is an account snapshot (every non-zero account, including
//! the withdrawal-counter slot) so the prover needs no chain access. Integers
//! are decimal strings and bytes are lowercase hex, as in every SDIQT format.

use qledger_core::{QledgerEntry, QledgerLedger};
use serde::{Deserialize, Serialize};

use crate::{build_chunks, ChunkInput, SigMode};

/// Format tag of [`BatchInput`].
pub const BATCH_INPUT_FORMAT: &str = "sdiqt-batch-input";
/// Version of [`BatchInput`].
pub const BATCH_INPUT_VERSION: &str = "1";

/// One batch to prove.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BatchInput {
    pub format: String,
    pub version: String,
    pub chain_id: String,
    pub rollup_id: String,
    pub batch_index: String,
    /// Inbox sequence the batch starts after.
    pub inbox_from: String,
    /// Inbox accumulator at `inbox_from` (hex; empty for the empty inbox).
    pub acc_from: String,
    pub parent_accounts: Vec<AccountJson>,
    pub entries: Vec<EntryJson>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountJson {
    pub id: String,
    pub balance: String,
    pub nonce: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EntryJson {
    pub height: String,
    pub poster: String,
    pub payload: String,
}

/// Why a [`BatchInput`] cannot be used.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InputError {
    Format(String),
    Field(&'static str, String),
}

impl std::fmt::Display for InputError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            InputError::Format(m) => write!(f, "batch input: {m}"),
            InputError::Field(name, v) => write!(f, "batch input: bad {name}: {v}"),
        }
    }
}

impl std::error::Error for InputError {}

fn int(name: &'static str, v: &str) -> Result<u64, InputError> {
    crate::parse_canonical_u64(v).ok_or_else(|| InputError::Field(name, v.to_string()))
}

fn bytes(name: &'static str, v: &str) -> Result<Vec<u8>, InputError> {
    if v.chars().any(|c| c.is_ascii_uppercase()) {
        return Err(InputError::Field(name, v.to_string()));
    }
    hex::decode(v).map_err(|_| InputError::Field(name, v.to_string()))
}

impl BatchInput {
    /// Check the tag and version.
    pub fn validate(&self) -> Result<(), InputError> {
        if self.format != BATCH_INPUT_FORMAT || self.version != BATCH_INPUT_VERSION {
            return Err(InputError::Format(format!(
                "expected {BATCH_INPUT_FORMAT} v{BATCH_INPUT_VERSION}, got {} v{}",
                self.format, self.version
            )));
        }
        Ok(())
    }

    pub fn batch_index(&self) -> Result<u64, InputError> {
        int("batch_index", &self.batch_index)
    }

    pub fn inbox_from(&self) -> Result<u64, InputError> {
        int("inbox_from", &self.inbox_from)
    }

    pub fn acc_from(&self) -> Result<Vec<u8>, InputError> {
        bytes("acc_from", &self.acc_from)
    }

    /// The parent ledger rebuilt from the snapshot.
    pub fn parent_ledger(&self) -> Result<QledgerLedger, InputError> {
        let mut ledger = QledgerLedger::new();
        for a in &self.parent_accounts {
            let id: [u8; 32] = bytes("account id", &a.id)?
                .try_into()
                .map_err(|_| InputError::Field("account id", a.id.clone()))?;
            ledger.put(&id, int("balance", &a.balance)?, int("nonce", &a.nonce)?);
        }
        Ok(ledger)
    }

    pub fn entries(&self) -> Result<Vec<QledgerEntry>, InputError> {
        self.entries
            .iter()
            .map(|e| {
                Ok(QledgerEntry {
                    height: int("height", &e.height)?,
                    poster: e.poster.clone(),
                    payload: bytes("payload", &e.payload)?,
                })
            })
            .collect()
    }

    /// Split the batch into chunk inputs of at most `chunk_size` entries.
    pub fn chunk_inputs(
        &self,
        chunk_size: usize,
        mode: SigMode,
    ) -> Result<(QledgerLedger, Vec<ChunkInput>), InputError> {
        self.validate()?;
        let parent = self.parent_ledger()?;
        let inputs = build_chunks(
            &self.chain_id,
            &self.rollup_id,
            &parent,
            self.inbox_from()?,
            self.acc_from()?,
            &self.entries()?,
            chunk_size,
            mode,
        );
        Ok((parent, inputs))
    }
}

impl From<&QledgerEntry> for EntryJson {
    fn from(e: &QledgerEntry) -> Self {
        EntryJson {
            height: e.height.to_string(),
            poster: e.poster.clone(),
            payload: hex::encode(&e.payload),
        }
    }
}
