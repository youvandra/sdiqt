//! SDIQT prover: execute or prove a qledger-v1 batch from the RDK golden
//! vectors as linked chunks, and report cycles, wall time, peak RSS and
//! proof size.

use std::time::Instant;

use clap::Parser;
use qledger_core::{QledgerEntry, QledgerLedger};
use sdiqt_statement::{build_chunks, link_chunks, run_chunk, BatchClaim, ChunkOutput, SigMode};
use serde_json::Value;
use sp1_sdk::{
    blocking::{ProveRequest, Prover, ProverClient},
    include_elf, Elf, ProvingKey, SP1Stdin,
};

const ELF: Elf = include_elf!("sdiqt-guest");

#[derive(Parser, Debug)]
struct Args {
    #[arg(long)]
    execute: bool,
    #[arg(long)]
    prove: bool,
    /// Core STARK instead of the recursively compressed STARK (both are
    /// hash-based; no SNARK wrap is ever used).
    #[arg(long)]
    core: bool,
    /// Signature mode: full (ML-DSA-44 in the proof) or v0 (public bits).
    #[arg(long, default_value = "full")]
    mode: String,
    /// Use only the first N golden entries.
    #[arg(long)]
    entries: Option<usize>,
    /// Most entries per chunk proof.
    #[arg(long, default_value = "4")]
    chunk_size: usize,
}

fn peak_rss_mb() -> f64 {
    let mut ru: libc::rusage = unsafe { std::mem::zeroed() };
    unsafe { libc::getrusage(libc::RUSAGE_SELF, &mut ru) };
    ru.ru_maxrss as f64 / 1024.0 / 1024.0 // bytes on macOS
}

fn hx(b: &[u8]) -> String {
    hex::encode(b)
}

fn main() {
    sp1_sdk::utils::setup_logger();
    let args = Args::parse();
    let v: Value =
        serde_json::from_str(include_str!("../../../../vectors/qledger-v328.json")).unwrap();
    let q = &v["qledger"];
    let mut entries: Vec<QledgerEntry> = q["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| QledgerEntry {
            height: e["height"].as_u64().unwrap(),
            poster: e["poster"].as_str().unwrap().to_string(),
            payload: hex::decode(e["payload"].as_str().unwrap()).unwrap(),
        })
        .collect();
    let whole = args.entries.is_none();
    if let Some(n) = args.entries {
        entries.truncate(n);
    }
    let mode = if args.mode == "v0" {
        SigMode::V0
    } else {
        SigMode::Full
    };
    let b = &q["batch"];
    let (chain, rollup) = (
        q["chainId"].as_str().unwrap(),
        q["rollupId"].as_str().unwrap(),
    );
    let parent = QledgerLedger::new();
    let inputs = build_chunks(
        chain,
        rollup,
        &parent,
        b["inboxStart"].as_u64().unwrap(),
        hex::decode(b["accFrom"].as_str().unwrap()).unwrap(),
        &entries,
        args.chunk_size,
        mode,
    );
    let want: Vec<ChunkOutput> = inputs.iter().map(run_chunk).collect();
    let claim = link_chunks(&parent.root(), &want).expect("host chunks link");
    println!(
        "entries={} chunks={} chunk_size={} mode={:?} state_root={}",
        entries.len(),
        inputs.len(),
        args.chunk_size,
        mode,
        hx(&claim.state_root)
    );
    if whole {
        check_against_chain(&claim, b);
    }

    let client = ProverClient::from_env();
    if args.execute {
        let mut total = 0u64;
        for (i, input) in inputs.iter().enumerate() {
            let mut stdin = SP1Stdin::new();
            stdin.write(input);
            let (mut out, report) = client.execute(ELF, stdin).run().unwrap();
            let got: ChunkOutput = out.read();
            assert_eq!(got, want[i], "guest output == host output");
            let c = report.total_instruction_count();
            total += c;
            println!(
                "chunk {i}: entries={} witnesses={} cycles={c}",
                input.entries.len(),
                input.witnesses.len()
            );
        }
        println!("cycles total: {total}");
    } else if args.prove {
        let pk = client.setup(ELF).expect("setup");
        let started = Instant::now();
        let mut outs = Vec::new();
        let mut proofs = Vec::new();
        for (i, input) in inputs.iter().enumerate() {
            let mut stdin = SP1Stdin::new();
            stdin.write(input);
            let t = Instant::now();
            let req = client.prove(&pk, stdin);
            let proof = if args.core {
                req.run()
            } else {
                req.compressed().run()
            }
            .expect("prove");
            let pt = t.elapsed();
            let size = bincode::serialize(&proof).unwrap().len();
            let t = Instant::now();
            client
                .verify(&proof, pk.verifying_key(), None)
                .expect("verify");
            println!(
                "chunk {i}: entries={} prove {:.1?} verify {:.1?} proof_bytes {size} peak_rss_mb {:.0}",
                input.entries.len(),
                pt,
                t.elapsed(),
                peak_rss_mb()
            );
            let mut pv = proof.public_values.clone();
            outs.push(pv.read::<ChunkOutput>());
            proofs.push(proof);
        }
        println!("all chunks proved in {:.1?}", started.elapsed());

        // Verifier side: every proof checks, then the public outputs link.
        let got = link_chunks(&parent.root(), &outs).expect("proved chunks link");
        assert_eq!(got, claim);
        if whole {
            check_against_chain(&got, b);
        }
        println!("linked claim == host claim");

        // Tamper: one flipped public-value byte fails the proof check.
        let mut bad = proofs[0].clone();
        let mut pv = bad.public_values.to_vec();
        let last = pv.len() - 1;
        pv[last] ^= 1;
        bad.public_values = sp1_sdk::SP1PublicValues::from(&pv);
        println!(
            "tampered public values rejected: {}",
            client.verify(&bad, pk.verifying_key(), None).is_err()
        );
        if outs.len() > 1 {
            let mut swapped = outs.clone();
            swapped.swap(0, 1);
            println!(
                "reordered chunks rejected: {}",
                link_chunks(&parent.root(), &swapped).is_err()
            );
            println!(
                "dropped chunk rejected: {}",
                link_chunks(&parent.root(), &outs[1..]).is_err()
            );
        }
    } else {
        eprintln!("use --execute or --prove");
    }
}

fn check_against_chain(c: &BatchClaim, b: &Value) {
    assert_eq!(hx(&c.state_root), b["stateRoot"].as_str().unwrap());
    assert_eq!(
        hx(&c.withdrawals_root),
        b["withdrawalsRoot"].as_str().unwrap()
    );
    assert_eq!(hx(&c.data_hash), b["dataHash"].as_str().unwrap());
    println!("claim == chain batch (stateRoot, withdrawalsRoot, dataHash)");
}
