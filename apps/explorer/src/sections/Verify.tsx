import { ShieldCheck, Terminal } from "lucide-react";
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
      <SectionHead eyebrow="Verify" title="Check a proof yourself." id="verify-title" center>
        The same open verifier runs in your browser and on your machine. The answer comes from your
        own device.
      </SectionHead>
      <div className="verify-grid">
        <article className="card card-pad verify-card verify-main">
          <span className="card-title">
            <ShieldCheck size={16} aria-hidden="true" /> In This Browser
          </span>
          <p className="t-large">
            Downloads the newest proven sdiqt-1 bundle and checks it with the SP1 verifier in
            WebAssembly. Then flip one byte and watch the check fail.
          </p>
          <dl className="verify-facts">
            <div>
              <dt>Per chunk proof</dt>
              <dd>1.27 MB</dd>
            </div>
            <div>
              <dt>Verify time</dt>
              <dd>30 to 62 ms</dd>
            </div>
            <div>
              <dt>Trusted setup</dt>
              <dd>None</dd>
            </div>
          </dl>
          <div className="verify-card-foot">
            <button
              type="button"
              className="btn btn-accent"
              disabled={!latest}
              onClick={() => latest && onVerify(latest.batch_index)}
            >
              Verify Latest Batch
            </button>
            <span className="t-small">
              {latest
                ? `sdiqt-1 batch ${latest.batch_index}`
                : "Waiting for the first proven batch"}
            </span>
          </div>
        </article>
        <article className="card card-pad verify-card">
          <div className="card-head">
            <span className="card-title">
              <Terminal size={16} aria-hidden="true" /> On Your Machine
            </span>
            <button type="button" className="btn btn-sm btn-secondary" onClick={copy}>
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
          <p className="t-small">
            Three commands with Rust installed. The bundle in the repo is a real batch of
            rdk-v328-e2e-mwd5v89d, a rollup run by another team.
          </p>
          <pre className="cmd">{QUICK_START}</pre>
        </article>
      </div>
    </section>
  );
}
