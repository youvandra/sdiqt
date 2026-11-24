import { Link } from "react-router";

export function NotFound() {
  return (
    <section className="section" style={{ paddingTop: 160, minHeight: "70vh" }}>
      <div className="section-title">
        <span className="eyebrow">404</span>
        <h1 className="t-h2">This page is missing.</h1>
        <Link to="/batches" className="btn btn-primary">
          Open Explorer
        </Link>
      </div>
    </section>
  );
}
