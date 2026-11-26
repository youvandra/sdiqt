import { useEffect } from "react";
import { Link } from "react-router";
import { SITE, useDocumentTitle } from "../lib/dom.ts";

/** Keeps search engines from indexing a path that has no page. */
function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement("meta");
    meta.name = "robots";
    meta.content = "noindex";
    document.head.append(meta);
    return () => meta.remove();
  }, []);
}

export function NotFound() {
  useDocumentTitle(`Page not found · ${SITE}`);
  useNoIndex();
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
