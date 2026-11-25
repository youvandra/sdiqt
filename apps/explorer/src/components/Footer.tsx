import { Link } from "react-router";
import { LICENSE_URL, REPO_URL, SPECS_URL } from "../lib/links.ts";
import { Logo } from "./Logo.tsx";
import { SECTIONS } from "./Nav.tsx";

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-about">
          <Logo />
          <p className="t-small">
            STARK validity receipts for QoreChain qledger rollups. Every batch is re-executed,
            proven and signed, and the proof stays checkable after the chain prunes the batch.
          </p>
        </div>
        <div className="footer-nav">
          <div className="footer-col">
            <span className="t-small-strong">Explorer</span>
            {SECTIONS.map((s) => (
              <Link key={s.id} className="t-small" to={`/#${s.id}`}>
                {s.label}
              </Link>
            ))}
          </div>
          <div className="footer-col">
            <span className="t-small-strong">Project</span>
            <a className="t-small" href={REPO_URL} target="_blank" rel="noreferrer">
              Source Code
            </a>
            <a className="t-small" href={SPECS_URL} target="_blank" rel="noreferrer">
              Specs
            </a>
            <a className="t-small" href={LICENSE_URL} target="_blank" rel="noreferrer">
              Apache-2.0 License
            </a>
          </div>
          <div className="footer-col">
            <span className="t-small-strong">Legal</span>
            <Link className="t-small" to="/privacy">
              Privacy Policy
            </Link>
            <Link className="t-small" to="/terms">
              Terms of Use
            </Link>
          </div>
        </div>
      </div>
      <div className="footer-bar">
        <span className="t-small">© 2026 SDIQT. Testnet software on QoreChain diana.</span>
        <span className="t-small">Built on the QoreChain RDK, SP1 and ML-DSA-87.</span>
      </div>
    </footer>
  );
}
