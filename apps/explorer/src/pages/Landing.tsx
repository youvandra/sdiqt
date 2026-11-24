import { Link } from "react-router";
import { REPO_URL } from "../lib/links.ts";
import "./landing.css";

export function Landing() {
  return (
    <section className="hero">
      <div className="hero-image" aria-hidden="true" />
      <div className="hero-content">
        <h1 className="t-h1 hero-heading">Every rollup batch, proven and signed.</h1>
        <p className="t-body hero-sub">
          SDIQT re-executes each batch of a QoreChain qledger rollup, proves it with a STARK and
          signs a receipt. The proof stays checkable after the chain prunes the batch.
        </p>
        <div className="hero-actions">
          <Link to="/batches" className="btn btn-primary">
            Open Explorer
          </Link>
          <a className="btn btn-secondary" href={REPO_URL} target="_blank" rel="noreferrer">
            GitHub
          </a>
        </div>
      </div>
      <span id="how-it-works" />
    </section>
  );
}
