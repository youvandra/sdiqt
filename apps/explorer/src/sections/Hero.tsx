import type { ApiHealthV1 } from "@sdiqt/protocol";
import { ArrowDown } from "lucide-react";
import { Link } from "react-router";
import { ago, num, SETTLEMENT, VALIDITY } from "../lib/format.ts";

/** Live status line under the hero copy: tower, rollup, chain height, last poll. */
function LiveStatus({
  health,
  error,
}: {
  health: ApiHealthV1 | undefined;
  error: string | undefined;
}) {
  if (!health) {
    return (
      <div className="live" data-tone={error ? "bad" : "wait"}>
        <span className="dot" />
        <span>{error ? "Watchtower unreachable" : "Connecting to the watchtower"}</span>
      </div>
    );
  }
  const ok = health.status === "ok";
  return (
    <div className="live" data-tone={ok ? "ok" : "bad"}>
      <span className="dot" />
      <span>{ok ? "Watchtower online" : "Watchtower stale"}</span>
      <span className="live-sep" />
      <span className="t-mono">{health.rollup_id}</span>
      {health.last_poll_height && (
        <>
          <span className="live-sep" />
          <span>Height {num(health.last_poll_height)}</span>
        </>
      )}
      {health.last_receipt && (
        <>
          <span className="live-sep" />
          <span>
            Latest batch {health.last_receipt.batch_index}:{" "}
            {SETTLEMENT[health.last_receipt.settlement].label},{" "}
            {VALIDITY[health.last_receipt.validity].label}
          </span>
        </>
      )}
      {health.last_poll_at && (
        <>
          <span className="live-sep" />
          <span>Checked {ago(health.last_poll_at)}</span>
        </>
      )}
    </div>
  );
}

export function Hero(p: { health: ApiHealthV1 | undefined; error: string | undefined }) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-image" aria-hidden="true" />
      <div className="hero-content">
        <h1 className="t-h1 hero-heading" id="hero-title">
          Every rollup batch, proven and signed.
        </h1>
        <p className="t-body hero-sub">
          SDIQT re-executes each batch, proves it with a STARK and signs a receipt with a
          post-quantum key. The proof stays checkable long after the chain prunes the batch.
        </p>
        <LiveStatus health={p.health} error={p.error} />
        <Link to="/#batches" className="btn btn-primary hero-cta">
          Browse Batches
          <ArrowDown size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
