import type { ApiRollupListV1, ApiRollupSummaryV1 } from "@sdiqt/protocol";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { ActivityChart, Sparkline } from "../components/Charts.tsx";
import { Badge } from "../components/Ui.tsx";
import type { Polled } from "../lib/api.ts";
import { dailyCounts, type Fleet, fleetDays } from "../lib/fleet.ts";
import { ago, num } from "../lib/format.ts";
import { rollupPath } from "../lib/rollup.ts";

/** What QoreChain did with the last wrong-root submission. */
const MISMATCH_FATE = {
  rejected: "Rejected by QoreChain",
  pending: "In its challenge window",
  final: "Final on QoreChain",
  unknown: "Chain record gone",
} as const;

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "");

/** Batches per day across the fleet, in its card. */
export function FleetActivity({
  list,
  fleet,
}: {
  list: ApiRollupListV1 | undefined;
  fleet: Polled<Fleet>;
}) {
  const reference = list?.reference ?? "sdiqt-1";
  const days = fleet.data ? fleetDays(fleet.data, reference) : [];
  return (
    <div className="card card-pad chart-card">
      <div className="card-head">
        <span className="card-title">Activity</span>
        <span className="t-caption">Every batch since the first one on diana</span>
      </div>
      {days.length > 0 ? (
        <ActivityChart days={days} reference={reference} />
      ) : (
        <p className="chart-reading t-small">
          {fleet.error && !fleet.data ? "Batch history is unavailable right now." : "Reading"}
        </p>
      )}
    </div>
  );
}

/** "11 rollups, 1,643 batches, 100% roots match" as head facts. */
export function FleetFacts({ list }: { list: ApiRollupListV1 | undefined }) {
  const rows = list?.rollups ?? [];
  if (rows.length === 0) return null;
  const batches = rows.reduce((n, r) => n + Number(r.batches), 0);
  const match = rows.reduce((n, r) => n + Number(r.match), 0);
  const wrong = rows.reduce((n, r) => n + Number(r.mismatches_total), 0);
  const rejected = rows.reduce((n, r) => n + Number(r.mismatches_rejected), 0);
  return (
    <dl className="head-facts">
      <div>
        <dt>Rollups</dt>
        <dd>{num(rows.length)}</dd>
      </div>
      <div>
        <dt>Batches</dt>
        <dd>{num(batches)}</dd>
      </div>
      <div>
        <dt>Roots Match</dt>
        <dd>{pct(match, batches)}</dd>
      </div>
      <div>
        <dt>Wrong Roots Rejected</dt>
        <dd>
          {num(rejected)}/{num(wrong)}
        </dd>
      </div>
    </dl>
  );
}

/** Every qledger-v1 rollup on QoreChain diana, filtered by a rollup id query. */
export function RollupTable({
  list,
  fleet,
  loading,
  error,
  query = "",
}: {
  list: ApiRollupListV1 | undefined;
  fleet: Polled<Fleet>;
  loading: boolean;
  error: string | undefined;
  query?: string;
}) {
  const q = query.trim().toLowerCase();
  const rows = (list?.rollups ?? []).filter((r) => r.rollup_id.toLowerCase().includes(q));
  const active = rows.filter((r) => Number(r.batches) > 0);
  const idle = rows.filter((r) => Number(r.batches) === 0);
  return (
    <div className="rtable">
      <div className="rtable-head" aria-hidden="true">
        <span>Rollup</span>
        <span>Coverage</span>
        <span>Last 14 Days</span>
        <span className="c-right">Batches</span>
        <span className="c-right">Roots Match</span>
        <span>Last Wrong Root</span>
        <span>Last Batch</span>
        <span />
      </div>
      {error && !list && (
        <div className="notice" data-tone="bad" role="alert" title={error}>
          The watchtower is unreachable right now. This page retries on its own.
        </div>
      )}
      {loading && !list && !error && (
        <div className="btable-empty" aria-live="polite">
          <p className="t-body">Reading</p>
        </div>
      )}
      {list && rows.length === 0 && (
        <div className="btable-empty">
          <p className="t-body">No rollup matches this search.</p>
        </div>
      )}
      <ul className="btable-list" aria-label="Rollups">
        {active.map((r) => (
          <li key={r.rollup_id}>
            <Row r={r} spark={fleet.data?.byRollup.get(r.rollup_id)} />
          </li>
        ))}
      </ul>
      {idle.length > 0 && (
        <details className="idle" open={q !== ""}>
          <summary className="t-small">
            Waiting for a first batch ({num(idle.length)})
            <ChevronRight size={16} aria-hidden="true" className="idle-chev" />
          </summary>
          <ul className="idle-list">
            {idle.map((r) => (
              <li key={r.rollup_id}>
                <Link to={rollupPath(r.rollup_id)} className="t-mono">
                  {r.rollup_id}
                </Link>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function Row({
  r,
  spark,
}: {
  r: ApiRollupSummaryV1;
  spark: Parameters<typeof dailyCounts>[0] | undefined;
}) {
  const stark = r.tier === "stark";
  const batches = Number(r.batches);
  const first = r.last_poll_at === null;
  const rejected = Number(r.submissions) - batches;
  const counts = spark ? dailyCounts(spark) : undefined;
  const recent = counts?.reduce((a, b) => a + b, 0) ?? 0;
  return (
    <Link to={rollupPath(r.rollup_id)} className="rtable-row">
      <span className="c-name">
        <span className="t-body-strong t-mono">{r.rollup_id}</span>
        {stark && <span className="c-sub">Our rollup</span>}
      </span>
      <span className="c-cover">
        {stark ? (
          <Badge tone="ok" title="Re-executed and proven by a STARK, receipts signed">
            STARK + Re-executed
          </Badge>
        ) : (
          <span className="t-small" title="Re-executed from chain data, receipts signed">
            Re-executed
          </span>
        )}
      </span>
      <span className="c-spark">
        {counts && (
          <Sparkline counts={counts} label={`${num(recent)} batches in the last 14 days`} />
        )}
      </span>
      <span className="c-right c-num t-small">
        {first ? "First pass" : num(r.batches)}
        {!first && rejected > 0 && <span className="c-sub">{num(rejected)} rejected</span>}
      </span>
      <span className="c-right c-num t-small">{first ? "" : pct(Number(r.match), batches)}</span>
      <span className="t-small">
        {r.last_mismatch ? (
          <>
            <span className="c-bad-text">Batch {r.last_mismatch.batch_index}</span>
            <span className="c-sub">{MISMATCH_FATE[r.last_mismatch.settlement]}</span>
          </>
        ) : (
          <span className="c-muted">{first ? "" : "None found"}</span>
        )}
      </span>
      <span className="t-small">
        {r.last_submitted_time ? ago(r.last_submitted_time) : "No batches yet"}
        {Number(r.submissions_24h) > 0 && (
          <span className="c-sub">{num(r.submissions_24h)} in 24 h</span>
        )}
      </span>
      <span className="c-chev" aria-hidden="true">
        <ChevronRight size={18} />
      </span>
      <span className="m-line t-caption">
        {[
          first ? "First pass" : `${num(r.batches)} batches`,
          first ? undefined : `${pct(Number(r.match), batches)} match`,
          r.last_submitted_time ? ago(r.last_submitted_time) : undefined,
        ]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </Link>
  );
}
