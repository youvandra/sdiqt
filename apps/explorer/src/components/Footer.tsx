import { Link } from "react-router";
import {
  addressUrl,
  CHAIN_ID,
  LICENSE_URL,
  NOBLE_URL,
  OPERATOR,
  RDK_DOCS_URL,
  RDK_URL,
  REPO_URL,
  SP1_URL,
  SPECS_URL,
} from "../lib/links.ts";
import { Logo } from "./Logo.tsx";
import { EXPLORER, SECTIONS } from "./Nav.tsx";
import { Hash } from "./Ui.tsx";

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-content">
        <div className="footer-about">
          <Logo />
          <p className="t-small">
            Hash-based STARK proofs and post-quantum receipts for QoreChain qledger rollups.
          </p>
          <dl className="footer-facts">
            <dt>Chain</dt>
            <dd className="t-mono">{CHAIN_ID}</dd>
            <dt>Rollup</dt>
            <dd className="t-mono">sdiqt-1</dd>
            <dt>Operator</dt>
            <dd>
              <Hash value={OPERATOR} head={10} tail={6} href={addressUrl(OPERATOR)} />
            </dd>
          </dl>
        </div>
        <div className="footer-nav">
          <div className="footer-col">
            <span className="t-small-strong">Site</span>
            {SECTIONS.map((s) => (
              <Link key={s.id} className="t-small" to={`/#${s.id}`}>
                {s.label}
              </Link>
            ))}
            <Link className="t-small" to={EXPLORER.to}>
              {EXPLORER.label}
            </Link>
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
            <span className="t-small-strong">QoreChain</span>
            <a className="t-small" href={RDK_DOCS_URL} target="_blank" rel="noreferrer">
              Rollup Docs
            </a>
            <a className="t-small" href={RDK_URL} target="_blank" rel="noreferrer">
              RDK Source
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
        <span className="t-small">
          Built on the{" "}
          <a href={RDK_URL} target="_blank" rel="noreferrer">
            QoreChain RDK
          </a>
          ,{" "}
          <a href={SP1_URL} target="_blank" rel="noreferrer">
            SP1
          </a>{" "}
          and{" "}
          <a href={NOBLE_URL} target="_blank" rel="noreferrer">
            noble ML-DSA
          </a>
          .
        </span>
      </div>
    </footer>
  );
}
