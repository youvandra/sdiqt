//! The SDIQT statement, proved per chunk of a batch.
//!
//! A chunk statement: running inbox entries `from+1 ..= to` (bound by the
//! inbox accumulator `acc_from -> acc_to`) from state root `start_root`
//! yields `end_root` and emits `withdrawals`. One batch is one or more chunks
//! whose roots and accumulators chain; [`link_chunks`] checks the chain and
//! derives what the batch posted on QoreChain: `data_hash`, `state_root`,
//! `withdrawals_root`. A batch the chain could force to 64 entries is proved
//! as several small chunks, each within one prover's memory.
//!
//! The same functions run on the host (to predict and to link) and in the
//! zkVM guest (to prove a chunk).

use std::cell::Cell;

use serde::{Deserialize, Serialize};

use qledger_core::*;

pub mod input;

/// How signatures are checked inside the statement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SigMode {
    /// ML-DSA-44 verified inside the proof.
    Full,
    /// One validity bit per decoded transaction, taken as a public input.
    V0,
}

/// Private and public inputs of one chunk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChunkInput {
    pub chain_id: String,
    pub rollup_id: String,
    /// State root before the chunk.
    pub start_root: [u8; 32],
    /// Inbox sequence before the chunk's first entry.
    pub from: u64,
    /// The accumulator at `from` (empty for 0).
    pub acc_from: Vec<u8>,
    pub entries: Vec<QledgerEntry>,
    /// Witnesses at `start_root` for every account the chunk touches.
    pub witnesses: Vec<QledgerWitness>,
    pub mode: SigMode,
    /// For [`SigMode::V0`]: the verdict for each signature check, in order.
    pub sig_bits: Vec<bool>,
}

/// What a chunk proof makes public.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ChunkOutput {
    pub chain_id: String,
    pub rollup_id: String,
    pub start_root: [u8; 32],
    pub end_root: [u8; 32],
    pub inbox_from: u64,
    pub inbox_to: u64,
    /// Accumulator at `inbox_from` (32 bytes; zero for the empty inbox).
    pub acc_from: [u8; 32],
    /// Accumulator at `inbox_to`.
    pub acc_to: [u8; 32],
    /// Withdrawals the chunk emits, in order (global indices).
    pub withdrawals: Vec<QledgerWithdrawal>,
    pub mode: SigMode,
    pub sig_bits: Vec<bool>,
}

/// What a batch posts on QoreChain, derived from its linked chunks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BatchClaim {
    pub chain_id: String,
    pub rollup_id: String,
    pub parent_root: [u8; 32],
    pub inbox_from: u64,
    pub inbox_end: u64,
    pub data_hash: [u8; 32],
    pub state_root: [u8; 32],
    pub withdrawals_root: Vec<u8>,
    pub mode: SigMode,
    pub chunks: usize,
}

fn acc32(acc: &[u8]) -> [u8; 32] {
    if acc.is_empty() {
        EMPTY_INBOX_ACC
    } else {
        acc.try_into().expect("a 32-byte accumulator")
    }
}

macro_rules! track {
    ($edge:literal, $name:literal) => {
        #[cfg(target_os = "zkvm")]
        println!(concat!("cycle-tracker-report-", $edge, ": ", $name));
    };
}

/// Evaluate a chunk. Panics (so no proof exists) when the witnesses do not
/// open `start_root` or do not cover the chunk.
pub fn run_chunk(input: &ChunkInput) -> ChunkOutput {
    track!("start", "inbox");
    let acc_from = acc32(&input.acc_from);
    let acc_to = acc32(&qledger_accumulate(
        &input.chain_id,
        &input.rollup_id,
        input.from,
        &input.acc_from,
        &input.entries,
    ));
    track!("end", "inbox");

    track!("start", "open-witnesses");
    let mut tree = QledgerPartialTree::new(&input.start_root, &input.witnesses)
        .expect("witnesses open start_root");
    track!("end", "open-witnesses");

    let i = Cell::new(0usize);
    let v0 = |_: &[u8], _: &[u8], _: &[u8]| {
        let k = i.get();
        i.set(k + 1);
        *input.sig_bits.get(k).expect("a bit per signature check")
    };
    let verifier: &dyn QledgerVerifier = match input.mode {
        SigMode::Full => &MLDSA44_VERIFIER,
        SigMode::V0 => &v0,
    };
    let env = QledgerEnv {
        chain_id: &input.chain_id,
        rollup_id: &input.rollup_id,
        verifier,
    };
    track!("start", "execute");
    let res = execute_qledger(&env, &mut tree, &input.entries).expect("witnesses cover the chunk");
    track!("end", "execute");
    if input.mode == SigMode::V0 {
        assert_eq!(i.get(), input.sig_bits.len(), "every bit used");
    }
    ChunkOutput {
        chain_id: input.chain_id.clone(),
        rollup_id: input.rollup_id.clone(),
        start_root: input.start_root,
        end_root: res.state_root,
        inbox_from: input.from,
        inbox_to: input.from + input.entries.len() as u64,
        acc_from,
        acc_to,
        withdrawals: res.withdrawals,
        mode: input.mode,
        sig_bits: if input.mode == SigMode::V0 {
            input.sig_bits.clone()
        } else {
            Vec::new()
        },
    }
}

/// Why chunks do not form one batch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkError {
    Empty,
    /// Chunk `i` does not continue chunk `i - 1` (or the first does not start
    /// at the parent root).
    Broken(usize, &'static str),
}

/// Check that `chunks` chain from `parent_root` and derive the batch claim.
/// The verifier compares this claim with the batch stored on QoreChain.
pub fn link_chunks(
    parent_root: &[u8; 32],
    chunks: &[ChunkOutput],
) -> Result<BatchClaim, LinkError> {
    let first = chunks.first().ok_or(LinkError::Empty)?;
    if &first.start_root != parent_root {
        return Err(LinkError::Broken(0, "start root is not the parent root"));
    }
    let mut withdrawals = Vec::new();
    for (i, c) in chunks.iter().enumerate() {
        if c.chain_id != first.chain_id || c.rollup_id != first.rollup_id {
            return Err(LinkError::Broken(i, "chain or rollup differs"));
        }
        if c.mode != first.mode {
            return Err(LinkError::Broken(i, "signature mode differs"));
        }
        if i > 0 {
            let p = &chunks[i - 1];
            if c.start_root != p.end_root {
                return Err(LinkError::Broken(
                    i,
                    "start root is not the previous end root",
                ));
            }
            if c.inbox_from != p.inbox_to || c.acc_from != p.acc_to {
                return Err(LinkError::Broken(i, "inbox range does not continue"));
            }
        }
        withdrawals.extend(c.withdrawals.iter().cloned());
    }
    let last = chunks.last().expect("non-empty");
    let data_hash = inbox_range_hash(&InboxRangeInput {
        chain_id: &first.chain_id,
        rollup_id: &first.rollup_id,
        from: first.inbox_from,
        to: last.inbox_to,
        acc_from: &first.acc_from,
        acc_to: &last.acc_to,
    });
    Ok(BatchClaim {
        chain_id: first.chain_id.clone(),
        rollup_id: first.rollup_id.clone(),
        parent_root: *parent_root,
        inbox_from: first.inbox_from,
        inbox_end: last.inbox_to,
        data_hash,
        state_root: last.end_root,
        withdrawals_root: qledger_withdrawals_root(&first.chain_id, &first.rollup_id, &withdrawals),
        mode: first.mode,
        chunks: chunks.len(),
    })
}

/// Host side: one [`ChunkInput`] from a full ledger at the chunk start, with
/// witnesses for every account the chunk touches (found by a dry run).
/// Returns the input and the ledger after the chunk.
pub fn build_chunk(
    chain_id: &str,
    rollup_id: &str,
    start: &QledgerLedger,
    from: u64,
    acc_from: Vec<u8>,
    entries: Vec<QledgerEntry>,
    mode: SigMode,
) -> (ChunkInput, QledgerLedger) {
    use std::cell::RefCell;
    let touched = RefCell::new(Vec::<[u8; 32]>::new());
    let bits = RefCell::new(Vec::<bool>::new());
    let rec = |pk: &[u8], m: &[u8], s: &[u8]| {
        let ok = MLDSA44_VERIFIER.verify(pk, m, s);
        bits.borrow_mut().push(ok);
        ok
    };
    struct Tracking<'a> {
        led: QledgerLedger,
        touched: &'a RefCell<Vec<[u8; 32]>>,
    }
    impl QledgerState for Tracking<'_> {
        fn get(&mut self, id: &[u8; 32]) -> Result<(u64, u64), QledgerError> {
            self.touched.borrow_mut().push(*id);
            Ok(self.led.account(id))
        }
        fn set(&mut self, id: &[u8; 32], b: u64, n: u64) -> Result<(), QledgerError> {
            self.touched.borrow_mut().push(*id);
            self.led.put(id, b, n);
            Ok(())
        }
        fn root(&self) -> [u8; 32] {
            self.led.root()
        }
    }
    let mut st = Tracking {
        led: start.clone(),
        touched: &touched,
    };
    let env = QledgerEnv {
        chain_id,
        rollup_id,
        verifier: &rec,
    };
    execute_qledger(&env, &mut st, &entries).expect("full ledger");
    let Tracking { led: after, .. } = st;
    let mut ids = touched.into_inner();
    ids.sort();
    ids.dedup();
    let witnesses = ids.iter().map(|id| start.witness(id)).collect();
    let input = ChunkInput {
        chain_id: chain_id.to_string(),
        rollup_id: rollup_id.to_string(),
        start_root: start.root(),
        from,
        acc_from,
        entries,
        witnesses,
        mode,
        sig_bits: if mode == SigMode::V0 {
            bits.into_inner()
        } else {
            Vec::new()
        },
    };
    (input, after)
}

/// Host side: split a batch into chunks of at most `chunk_size` entries.
#[allow(clippy::too_many_arguments)] // mirrors the chain's batch fields one to one
pub fn build_chunks(
    chain_id: &str,
    rollup_id: &str,
    parent: &QledgerLedger,
    from: u64,
    acc_from: Vec<u8>,
    entries: &[QledgerEntry],
    chunk_size: usize,
    mode: SigMode,
) -> Vec<ChunkInput> {
    assert!(chunk_size > 0);
    let mut out = Vec::new();
    let (mut led, mut seq, mut acc) = (parent.clone(), from, acc_from);
    for part in entries.chunks(chunk_size) {
        let next_acc = qledger_accumulate(chain_id, rollup_id, seq, &acc, part);
        let (input, after) = build_chunk(chain_id, rollup_id, &led, seq, acc, part.to_vec(), mode);
        out.push(input);
        led = after;
        seq += part.len() as u64;
        acc = next_acc;
    }
    out
}
