import { Link } from "react-router";

export function NotFound() {
  return (
    <section className="section not-found" aria-labelledby="nf-title">
      <div className="section-head">
        <span className="eyebrow">404</span>
        <h1 className="t-h2" id="nf-title">
          This page is missing.
        </h1>
        <p className="t-body">Every rollup and every batch opens from the explorer home.</p>
        <Link to="/" className="btn btn-primary">
          Open Explorer
        </Link>
      </div>
    </section>
  );
}
