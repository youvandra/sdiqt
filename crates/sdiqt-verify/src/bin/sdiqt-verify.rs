//! `sdiqt-verify bundle <dir> [--vkey-hash HEX]`: verify a proof bundle and
//! print the batch it proves. Exit code 0 = VALID, 1 = INVALID, 2 = usage.

use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

use sdiqt_verify::bundle::Manifest;
use sdiqt_verify::verify_bundle;

const USAGE: &str = "usage: sdiqt-verify bundle <dir> [--vkey-hash HEX]";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let (dir, vkey) = match args.as_slice() {
        [cmd, dir] if cmd == "bundle" => (PathBuf::from(dir), None),
        [cmd, dir, flag, v] if cmd == "bundle" && flag == "--vkey-hash" => {
            (PathBuf::from(dir), Some(v.clone()))
        }
        _ => {
            eprintln!("{USAGE}");
            return ExitCode::from(2);
        }
    };

    let started = Instant::now();
    let result = Manifest::read(&dir)
        .map_err(|e| e.to_string())
        .and_then(|m| {
            let proofs = m
                .chunks
                .iter()
                .map(|c| std::fs::read(dir.join(&c.file)).map_err(|e| format!("{}: {e}", c.file)))
                .collect::<Result<Vec<_>, _>>()?;
            verify_bundle(&m, &proofs, vkey.as_deref())
                .map(|claim| (m, claim))
                .map_err(|e| e.to_string())
        });

    match result {
        Ok((m, claim)) => {
            println!("VALID in {:.1?}", started.elapsed());
            println!(
                "  chain {} rollup {} batch {}",
                m.chain_id, m.rollup_id, m.batch_index
            );
            println!(
                "  inbox {}..{} in {} chunk(s), signatures {}",
                claim.inbox_from, claim.inbox_end, claim.chunks, m.sig_mode
            );
            println!("  state_root       {}", m.state_root);
            println!("  withdrawals_root {}", m.withdrawals_root);
            println!("  data_hash        {}", m.data_hash);
            println!("  manifest sha256  {}", hex::encode(m.hash()));
            ExitCode::SUCCESS
        }
        Err(reason) => {
            println!("INVALID in {:.1?}: {reason}", started.elapsed());
            ExitCode::from(1)
        }
    }
}
