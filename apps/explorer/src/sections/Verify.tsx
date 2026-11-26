import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { SectionHead } from "../components/Ui.tsx";
import type { BatchRow } from "../lib/format.ts";
import { REPO_URL } from "../lib/links.ts";

const QUICK_START = `git clone ${REPO_URL} && cd sdiqt
cargo install --locked --path crates/sdiqt-verify
sdiqt-verify bundle vectors/bundles/rdk-v328-e2e/batch-1-FACE91C06DA7`;

/** The newest batch with a verified proof, if any. */
function latestProven(rows: BatchRow[]): BatchRow | undefined {
  return [...rows].reverse().find((r) => r.validity === "proven");
}

export function Verify({
  rows,
  onVerify,
}: {
  rows: BatchRow[];
  onVerify: (index: string) => void;
}) {
  const latest = latestProven(rows);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(QUICK_START);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked; the commands stay selectable.
    }
  };

  return (
    <section className="section verify" id="verify" aria-labelledby="verify-title">
      <div className="polka" aria-hidden="true" />
      <SectionHead eyebrow="Verify" title="Check a proof yourself." id="verify-title">
        Two ways, same verifier code. Either way the proof answer comes from your own machine.
      </SectionHead>
      <div className="verify-grid">
        <article className="card card-pad verify-card">
          <span className="card-title">
            <ShieldCheck size={16} aria-hidden="true" /> In this browser
          </span>
          <p className="t-body">
            Downloads the newest proven batch's STARK bundle and verifies it here with the SP1
            verifier compiled to WebAssembly. Then flip one byte and watch it fail.
          </p>
          <div className="verify-card-foot">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!latest}
              onClick={() => latest && onVerify(latest.batch_index)}
            >
              Verify Latest Batch
            </button>
            <span className="t-small">
              {latest ? `Batch ${latest.batch_index}` : "Waiting for the first proven batch"}
            </span>
          </div>
        </article>
        <article className="card card-pad verify-card">
          <div className="card-head">
            <span className="card-title">On your machine</span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="t-body">
            Three commands with Rust installed. The bundle in the repo is a real batch of the
            rdk-v328-e2e rollup on QoreChain diana.
          </p>
          <pre className="cmd">{QUICK_START}</pre>
        </article>
      </div>
    </section>
  );
}
