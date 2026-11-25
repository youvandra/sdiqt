import { Link } from "react-router";
import { ISSUES_URL, LICENSE_URL } from "../lib/links.ts";

const UPDATED = "25 November 2026";

function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <article className="section legal" aria-labelledby="legal-title">
      <div className="legal-head">
        <span className="eyebrow">Legal</span>
        <h1 className="t-h2" id="legal-title">
          {title}
        </h1>
        <p className="t-small">Last updated {UPDATED}</p>
      </div>
      <div className="legal-body">{children}</div>
    </article>
  );
}

export function Privacy() {
  return (
    <LegalPage title="Privacy Policy">
      <h2 className="t-large">What this site collects</h2>
      <p className="t-body">
        The SDIQT explorer has no accounts, no cookies, no analytics and no third-party trackers.
        Fonts and images are served from sdiqt.xyz itself, and the page talks only to the SDIQT
        watchtower API at <code>/api</code>.
      </p>
      <h2 className="t-large">Server logs</h2>
      <p className="t-body">
        The web server keeps standard access logs (IP address, time, requested path, user agent) for
        up to 14 days to keep the service running and to stop abuse. They are deleted after that and
        stay private.
      </p>
      <h2 className="t-large">Chain data</h2>
      <p className="t-body">
        Everything the explorer shows comes from the public QoreChain diana testnet: batch roots,
        transaction hashes and account addresses that anyone can read on chain.
      </p>
      <h2 className="t-large">Contact</h2>
      <p className="t-body">
        Questions go to the{" "}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer">
          GitHub issue tracker
        </a>
        . See also the <Link to="/terms">Terms of Use</Link>.
      </p>
    </LegalPage>
  );
}

export function Terms() {
  return (
    <LegalPage title="Terms of Use">
      <h2 className="t-large">Testnet software</h2>
      <p className="t-body">
        SDIQT runs on the QoreChain diana testnet. The software is provided as is, without warranty,
        under the{" "}
        <a href={LICENSE_URL} target="_blank" rel="noreferrer">
          Apache-2.0 License
        </a>
        . Testnet tokens have no value.
      </p>
      <h2 className="t-large">Receipts are informational</h2>
      <p className="t-body">
        A receipt records what the SDIQT watchtower saw and proved at the time it was signed.
        QoreChain alone decides whether a batch settles. Nothing on this site is financial or
        investment advice.
      </p>
      <h2 className="t-large">Fair use</h2>
      <p className="t-body">
        Use the explorer and its API at a reasonable rate. Attempts to overload, scrape at scale or
        break the service may be blocked.
      </p>
      <h2 className="t-large">Contact</h2>
      <p className="t-body">
        Report problems on the{" "}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer">
          GitHub issue tracker
        </a>
        . See also the <Link to="/privacy">Privacy Policy</Link>.
      </p>
    </LegalPage>
  );
}
