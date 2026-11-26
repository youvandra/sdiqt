import type { ApiHealthV1, ApiRollupListV1 } from "@sdiqt/protocol";
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

/** ", 1,635 batches across 11 rollups so far," once the list is in; empty before that. */
function coverage(list: ApiRollupListV1 | undefined): string {
  const rows = list?.rollups ?? [];
  if (rows.length === 0) return "";
  const batches = rows.reduce((t, r) => t + Number(r.batches), 0);
  return `, ${num(batches)} batches across ${num(rows.length)} rollups so far,`;
}

export function Hero(p: {
  health: ApiHealthV1 | undefined;
  error: string | undefined;
  rollups: ApiRollupListV1 | undefined;
}) {
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-image" aria-hidden="true" />
      <div className="hero-content">
        <h1 className="t-h1 hero-heading" id="hero-title">
          Every qledger rollup batch, checked and signed.
        </h1>
        <p className="t-body hero-sub">
          SDIQT re-executes every batch of every qledger-v1 rollup on QoreChain diana from the
          public inbox{coverage(p.rollups)} and signs a receipt for each with a post-quantum key. On
          its own rollup, sdiqt-1, every batch also carries a STARK proof that stays checkable long
          after the chain prunes it.
        </p>
        <LiveStatus health={p.health} error={p.error} />
        <Link to="/#rollups" className="btn btn-primary hero-cta">
          Browse Rollups
          <ArrowDown size={16} aria-hidden="true" />
        </Link>
      </div>
    </section>
  );
}
