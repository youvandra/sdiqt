import { Link } from "react-router";
import { REPO_URL, SPECS_URL } from "../lib/links.ts";
import { Logo } from "./Logo.tsx";

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-about">
          <Logo gap={6} />
          <p className="t-small">
            STARK validity receipts for a QoreChain qledger rollup. Every batch is re-executed,
            proven and signed, and anyone can check the proof in a browser.
          </p>
        </div>
        <div className="footer-nav">
          <div className="footer-col">
            <span className="t-small-strong">Explorer</span>
            <Link className="t-small" to="/batches">
              Batches
            </Link>
            <Link className="t-small" to="/security">
              Security
            </Link>
          </div>
          <div className="footer-col">
            <span className="t-small-strong">Verify</span>
            <Link className="t-small" to="/#how-it-works">
              How It Works
            </Link>
            <a className="t-small" href={`${REPO_URL}#verify-it-yourself`}>
              CLI Quick Start
            </a>
          </div>
          <div className="footer-col">
            <span className="t-small-strong">Project</span>
            <a className="t-small" href={REPO_URL}>
              GitHub
            </a>
            <a className="t-small" href={SPECS_URL}>
              Specs
            </a>
          </div>
        </div>
      </div>
      <div className="footer-bar">
        <span className="t-small">Built on</span>
        <span className="t-small-strong">QoreChain RDK, SP1 and ML-DSA-87</span>
      </div>
    </footer>
  );
}
