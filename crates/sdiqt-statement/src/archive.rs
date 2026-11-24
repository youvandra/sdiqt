//! Batch inputs built from the archive (`apps/archiver`).
//!
//! qledger state is a function of the inbox alone: the parent state of a batch
//! is every entry up to its `inbox_start` executed from the empty ledger, and
//! `acc_from` is the accumulator over the same entries. Both come from the
//! archive, so no retained chain state is needed.

use qledger_core::*;
use serde::{Deserialize, Serialize};

use crate::input::{
    AccountJson, BatchInput, EntryJson, InputError, BATCH_INPUT_FORMAT, BATCH_INPUT_VERSION,
};
use crate::BatchClaim;

/// One line of `inbox.jsonl`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveEntry {
    pub v: u32,
    pub kind: String,
    pub sequence: String,
    pub height: String,
    pub txhash: String,
    pub poster: String,
    pub data_hash: String,
    pub payload: String,
}

/// One line of `batches.jsonl`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ArchiveBatch {
    pub v: u32,
    pub kind: String,
    pub batch_index: String,
    pub height: String,
    pub txhash: String,
    pub msg_index: String,
    pub sequencer: String,
    pub inbox_start: String,
    pub inbox_end: String,
    pub tx_count: String,
    pub prev_state_root: String,
    pub state_root: String,
    pub withdrawals_root: String,
    pub data_hash: String,
}

fn int(name: &'static str, v: &str) -> Result<u64, InputError> {
    v.parse()
        .map_err(|_| InputError::Field(name, v.to_string()))
}

fn entry(e: &ArchiveEntry) -> Result<QledgerEntry, InputError> {
    let payload =
        hex::decode(&e.payload).map_err(|_| InputError::Field("payload", e.sequence.clone()))?;
    if hex::encode(posted_data_hash(&payload)) != e.data_hash {
        return Err(InputError::Field("data_hash", e.sequence.clone()));
    }
    Ok(QledgerEntry {
        height: int("height", &e.height)?,
        poster: e.poster.clone(),
        payload,
    })
}

/// The batch input for `batch`, from archive entries that start at sequence 1
/// and reach at least the batch's `inbox_end`.
pub fn batch_input_from_archive(
    chain_id: &str,
    rollup_id: &str,
    archive: &[ArchiveEntry],
    batch: &ArchiveBatch,
) -> Result<BatchInput, InputError> {
    let start = int("inbox_start", &batch.inbox_start)? as usize;
    let end = int("inbox_end", &batch.inbox_end)? as usize;
    if end <= start {
        return Err(InputError::Field("inbox_end", batch.inbox_end.clone()));
    }
    if archive.len() < end {
        return Err(InputError::Format(format!(
            "archive holds {} entries, the batch needs {end}",
            archive.len()
        )));
    }
    let mut entries = Vec::with_capacity(end);
    for (i, e) in archive[..end].iter().enumerate() {
        if int("sequence", &e.sequence)? != i as u64 + 1 {
            return Err(InputError::Format(format!(
                "archive entry {} is not sequence {}",
                e.sequence,
                i + 1
            )));
        }
        entries.push(entry(e)?);
    }
    let (before, batch_entries) = entries.split_at(start);

    let mut parent = QledgerLedger::new();
    let env = QledgerEnv {
        chain_id,
        rollup_id,
        verifier: &MLDSA44_VERIFIER,
    };
    execute_qledger(&env, &mut parent, before)
        .map_err(|e| InputError::Format(format!("replay: {e:?}")))?;
    let acc_from = if start == 0 {
        String::new()
    } else {
        hex::encode(qledger_accumulate(chain_id, rollup_id, 0, &[], before))
    };

    Ok(BatchInput {
        format: BATCH_INPUT_FORMAT.into(),
        version: BATCH_INPUT_VERSION.into(),
        chain_id: chain_id.into(),
        rollup_id: rollup_id.into(),
        batch_index: batch.batch_index.clone(),
        inbox_from: start.to_string(),
        acc_from,
        parent_accounts: parent
            .accounts()
            .into_iter()
            .map(|(id, balance, nonce)| AccountJson {
                id: hex::encode(id),
                balance: balance.to_string(),
                nonce: nonce.to_string(),
            })
            .collect(),
        entries: batch_entries.iter().map(EntryJson::from).collect(),
    })
}

/// Fields where `claim` differs from what the chain recorded for `batch`;
/// empty when the claim matches.
pub fn claim_mismatches(claim: &BatchClaim, batch: &ArchiveBatch) -> Vec<String> {
    let mut out = Vec::new();
    let mut check = |name: &str, ours: String, chain: &str| {
        if ours != chain {
            out.push(format!("{name}: claim {ours}, chain {chain}"));
        }
    };
    check(
        "prev_state_root",
        hex::encode(claim.parent_root),
        &batch.prev_state_root,
    );
    check(
        "state_root",
        hex::encode(claim.state_root),
        &batch.state_root,
    );
    check(
        "withdrawals_root",
        hex::encode(&claim.withdrawals_root),
        &batch.withdrawals_root,
    );
    check("data_hash", hex::encode(claim.data_hash), &batch.data_hash);
    check(
        "inbox_from",
        claim.inbox_from.to_string(),
        &batch.inbox_start,
    );
    check("inbox_end", claim.inbox_end.to_string(), &batch.inbox_end);
    out
}
