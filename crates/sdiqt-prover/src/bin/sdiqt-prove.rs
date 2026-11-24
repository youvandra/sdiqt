//! SDIQT prover host.
//!
//!   sdiqt-prove golden-input [--entries N]          print the RDK golden batch as a batch input
//!   sdiqt-prove execute <input.json> [--chunk-size N] [--mode full|v0]
//!   sdiqt-prove prove <input.json> --out <dir> [--chunk-size N] [--mode full|v0]
//!
//! `execute` runs every chunk in the zkVM without proving and reports cycles.
//! `prove` proves every chunk as a compressed STARK (hash-based, no SNARK
//! wrap), verifies it, links the chunks and writes a proof bundle v1.

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::time::Instant;

use clap::{Parser, Subcommand, ValueEnum};
use qledger_core::QledgerEntry;
use sdiqt_statement::input::{BatchInput, EntryJson, BATCH_INPUT_FORMAT, BATCH_INPUT_VERSION};
use sdiqt_statement::{link_chunks, run_chunk, BatchClaim, ChunkInput, ChunkOutput, SigMode};
use sdiqt_verify::bundle::{
    chunk_file, proof_root, sha256, ChunkEntry, Manifest, BUNDLE_FORMAT, BUNDLE_VERSION,
};
use sdiqt_verify::{decode_public_values, sig_mode_name};
use serde_json::Value;
use sp1_sdk::{
    blocking::{ProveRequest, Prover, ProverClient},
    include_elf, Elf, HashableKey, ProvingKey, SP1Stdin,
};

const ELF: Elf = include_elf!("sdiqt-guest");
const SP1_VERSION: &str = "6.10.0";
const GOLDEN: &str = include_str!("../../../../vectors/qledger-v328.json");

#[derive(Parser)]
#[command(
    name = "sdiqt-prove",
    about = "Execute or prove qledger-v1 batches as linked SP1 chunk proofs"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Clone, Copy, ValueEnum)]
enum Mode {
    /// ML-DSA-44 verified inside the proof.
    Full,
    /// One public validity bit per transaction.
    V0,
}

impl From<Mode> for SigMode {
    fn from(m: Mode) -> Self {
        match m {
            Mode::Full => SigMode::Full,
            Mode::V0 => SigMode::V0,
        }
    }
}

#[derive(clap::Args)]
struct ChunkArgs {
    /// Most entries per chunk proof.
    #[arg(long, default_value_t = 4)]
    chunk_size: usize,
    #[arg(long, value_enum, default_value_t = Mode::Full)]
    mode: Mode,
}

#[derive(Subcommand)]
enum Cmd {
    /// Print the RDK golden batch (vectors/qledger-v328.json) as a batch input.
    GoldenInput {
        /// Keep only the first N entries.
        #[arg(long)]
        entries: Option<usize>,
    },
    /// Run every chunk in the zkVM without proving; report cycles.
    Execute {
        input: PathBuf,
        #[command(flatten)]
        chunks: ChunkArgs,
    },
    /// Prove every chunk and write a proof bundle.
    Prove {
        input: PathBuf,
        #[arg(long)]
        out: PathBuf,
        #[command(flatten)]
        chunks: ChunkArgs,
    },
}

fn main() -> ExitCode {
    sp1_sdk::utils::setup_logger();
    let result = match Cli::parse().cmd {
        Cmd::GoldenInput { entries } => golden_input(entries),
        Cmd::Execute { input, chunks } => execute(&input, &chunks),
        Cmd::Prove { input, out, chunks } => prove(&input, &out, &chunks),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(e) => {
            eprintln!("error: {e}");
            ExitCode::FAILURE
        }
    }
}

type Result<T> = std::result::Result<T, String>;

fn golden_input(limit: Option<usize>) -> Result<()> {
    let v: Value = serde_json::from_str(GOLDEN).map_err(|e| e.to_string())?;
    let q = &v["qledger"];
    let field = |val: &Value, name: &str| -> Result<String> {
        val[name]
            .as_str()
            .map(str::to_string)
            .ok_or_else(|| format!("golden vectors: missing {name}"))
    };
    let mut entries: Vec<EntryJson> = q["entries"]
        .as_array()
        .ok_or("golden vectors: missing entries")?
        .iter()
        .map(|e| {
            Ok(EntryJson {
                height: e["height"]
                    .as_u64()
                    .ok_or("golden vectors: bad height")?
                    .to_string(),
                poster: field(e, "poster")?,
                payload: field(e, "payload")?,
            })
        })
        .collect::<Result<_>>()?;
    if let Some(n) = limit {
        entries.truncate(n);
    }
    let b = &q["batch"];
    let input = BatchInput {
        format: BATCH_INPUT_FORMAT.into(),
        version: BATCH_INPUT_VERSION.into(),
        chain_id: field(q, "chainId")?,
        rollup_id: field(q, "rollupId")?,
        batch_index: "0".into(),
        inbox_from: b["inboxStart"]
            .as_u64()
            .ok_or("golden vectors: bad inboxStart")?
            .to_string(),
        acc_from: field(b, "accFrom")?,
        parent_accounts: Vec::new(),
        entries,
    };
    println!(
        "{}",
        serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?
    );
    Ok(())
}

struct Planned {
    input: BatchInput,
    parent_root: [u8; 32],
    chunks: Vec<ChunkInput>,
    claim: BatchClaim,
}

fn plan(path: &Path, args: &ChunkArgs) -> Result<Planned> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let input: BatchInput =
        serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let (parent, chunks) = input
        .chunk_inputs(args.chunk_size, args.mode.into())
        .map_err(|e| e.to_string())?;
    let outputs: Vec<ChunkOutput> = chunks.iter().map(run_chunk).collect();
    let claim = link_chunks(&parent.root(), &outputs)
        .map_err(|e| format!("host chunks do not link: {e:?}"))?;
    let entries: Vec<QledgerEntry> = input.entries().map_err(|e| e.to_string())?;
    println!(
        "batch {} entries={} chunks={} chunk_size={} mode={} state_root={}",
        input.batch_index,
        entries.len(),
        chunks.len(),
        args.chunk_size,
        sig_mode_name(claim.mode),
        hex::encode(claim.state_root)
    );
    Ok(Planned {
        parent_root: parent.root(),
        input,
        chunks,
        claim,
    })
}

fn execute(path: &Path, args: &ChunkArgs) -> Result<()> {
    let p = plan(path, args)?;
    let client = ProverClient::from_env();
    let mut total = 0u64;
    for (i, chunk) in p.chunks.iter().enumerate() {
        let mut stdin = SP1Stdin::new();
        stdin.write(chunk);
        let (mut out, report) = client
            .execute(ELF, stdin)
            .run()
            .map_err(|e| e.to_string())?;
        if out.read::<ChunkOutput>() != run_chunk(chunk) {
            return Err(format!("chunk {i}: guest output differs from host output"));
        }
        let cycles = report.total_instruction_count();
        total += cycles;
        println!(
            "chunk {i}: entries={} witnesses={} cycles={cycles}",
            chunk.entries.len(),
            chunk.witnesses.len()
        );
    }
    println!("cycles total: {total}");
    Ok(())
}

fn prove(path: &Path, out: &Path, args: &ChunkArgs) -> Result<()> {
    let p = plan(path, args)?;
    std::fs::create_dir_all(out).map_err(|e| format!("{}: {e}", out.display()))?;
    let client = ProverClient::from_env();
    let pk = client.setup(ELF).map_err(|e| e.to_string())?;
    let vkey_hash =
        bincode::serialize(&pk.verifying_key().hash_koalabear()).map_err(|e| e.to_string())?;

    let started = Instant::now();
    let mut entries = Vec::new();
    let mut hashes = Vec::new();
    let mut outputs = Vec::new();
    for (i, chunk) in p.chunks.iter().enumerate() {
        let mut stdin = SP1Stdin::new();
        stdin.write(chunk);
        let t = Instant::now();
        let proof = client
            .prove(&pk, stdin)
            .compressed()
            .run()
            .map_err(|e| e.to_string())?;
        let prove_time = t.elapsed();
        let t = Instant::now();
        client
            .verify(&proof, pk.verifying_key(), None)
            .map_err(|e| format!("chunk {i}: own proof does not verify: {e}"))?;
        let bytes = bincode::serialize(&proof.proof).map_err(|e| e.to_string())?;
        let pv = proof.public_values.to_vec();
        println!(
            "chunk {i}: entries={} prove {prove_time:.1?} verify {:.1?} proof_bytes {} peak_rss_mb {:.0}",
            chunk.entries.len(),
            t.elapsed(),
            bytes.len(),
            peak_rss_mb()
        );
        let file = chunk_file(i);
        std::fs::write(out.join(&file), &bytes).map_err(|e| format!("{file}: {e}"))?;
        let hash = sha256(&bytes);
        entries.push(ChunkEntry {
            index: i.to_string(),
            file,
            proof_sha256: hex::encode(hash),
            public_values: hex::encode(&pv),
        });
        hashes.push(hash);
        outputs.push(decode_public_values(&pv)?);
    }

    let linked = link_chunks(&p.parent_root, &outputs)
        .map_err(|e| format!("proved chunks do not link: {e:?}"))?;
    if linked != p.claim {
        return Err("proved claim differs from the host claim".into());
    }
    let c = &p.claim;
    let manifest = Manifest {
        format: BUNDLE_FORMAT.into(),
        version: BUNDLE_VERSION.into(),
        chain_id: c.chain_id.clone(),
        rollup_id: c.rollup_id.clone(),
        batch_index: p.input.batch_index.clone(),
        inbox_from: c.inbox_from.to_string(),
        inbox_end: c.inbox_end.to_string(),
        parent_root: hex::encode(c.parent_root),
        state_root: hex::encode(c.state_root),
        withdrawals_root: hex::encode(&c.withdrawals_root),
        data_hash: hex::encode(c.data_hash),
        sig_mode: sig_mode_name(c.mode).into(),
        sp1_version: SP1_VERSION.into(),
        program_vkey_hash: hex::encode(&vkey_hash),
        proof_root: hex::encode(proof_root(&hashes)),
        chunks: entries,
    };
    manifest.write(out).map_err(|e| e.to_string())?;
    println!(
        "all chunks proved in {:.1?}; bundle {} manifest sha256 {}",
        started.elapsed(),
        out.display(),
        hex::encode(manifest.hash())
    );
    Ok(())
}

fn peak_rss_mb() -> f64 {
    // SAFETY: getrusage only writes into the zeroed struct we pass.
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut ru) };
    ru.ru_maxrss as f64 / 1024.0 / 1024.0 // bytes on macOS
}
