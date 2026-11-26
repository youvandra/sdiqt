import type { ApiHealthV1, ApiRollupSummaryV1, CountsV1 } from "@sdiqt/protocol";
import { Hourglass } from "lucide-react";
import { SectionHead } from "../components/Ui.tsx";
import type { Filter } from "../lib/filters.ts";
import {
  axis,
  type BatchRow,
  duration,
  entryCount,
  num,
  SETTLEMENT,
  SETTLEMENT_ORDER,
  type Settlement,
  type Validity,
} from "../lib/format.ts";
import { useRollup } from "../lib/rollup.ts";
import { useNow } from "../lib/useNow.ts";

interface Props {
  rows: BatchRow[];
  health: ApiHealthV1 | undefined;
  /** PROOF.md numbers at one chain height; null when not deployed. */
  counts: CountsV1 | null;
  /** This rollup's row of /api/rollups: counts replaced submissions too. */
  summary?: ApiRollupSummaryV1 | undefined;
  onOpen: (index: string) => void;
  onFilter: (f: Partial<Filter>) => void;
}

export function Overview({ rows, health, counts, summary, onOpen, onFilter }: Props) {
  const { tier } = useRollup();
  const total = rows.length;
  const final = rows.filter((r) => r.settlement === "final").length;
  const proven = rows.filter((r) => r.validity === "proven").length;
  const matched = rows.filter((r) => r.judged === "match").length;
  // Replaced submissions are gone from `rows`; the summary still counts them.
  const found = summary
    ? Number(summary.mismatches_total)
    : rows.filter((r) => r.judged === "mismatch").length;
  const voided = summary
    ? Number(summary.mismatches_rejected)
    : rows.filter((r) => r.judged === "mismatch" && r.settlement === "rejected").length;
  const share = (n: number) =>
    total ? `${Math.round((n / total) * 100)}% of batches` : "No batches yet";
  const rolledBack = rows.reduce((n, r) => n + Number(r.submissions) - 1, 0);
  const entriesTotal = rows.reduce((n, r) => n + entryCount(r.inbox_from, r.inbox_end), 0);

  return (
    <section className="section overview" id="overview" aria-labelledby="overview-title">
      <div className="streak" aria-hidden="true" />
      <SectionHead eyebrow="Live" title="The rollup at a glance." id="overview-title">
        {tier === "stark"
          ? "Two independent answers for every batch: QoreChain says whether it settled, the STARK says whether it was executed correctly."
          : "Two answers for every batch: QoreChain says whether it settled, and SDIQT re-executes it from the public inbox to check the roots. Proofs run on sdiqt-1, the reference rollup."}
      </SectionHead>

      <div className="card stats-card">
        <Stat
          value={num(total)}
          label="Batches tracked"
          note={`${num(entriesTotal)} inbox entries`}
        />
        <Stat value={num(final)} label="Final on QoreChain" note={share(final)} />
        {tier === "stark" ? (
          <Stat value={num(proven)} label="Proven by a STARK" note={share(proven)} />
        ) : (
          <>
            <Stat value={num(matched)} label="Re-executed: match" note={share(matched)} />
            <Stat
              value={num(found)}
              label="Mismatching submissions"
              note={
                found === 0
                  ? "Every batch gives the chain's roots"
                  : `${num(voided)} rejected by QoreChain`
              }
            />
          </>
        )}
        {tier === "stark" && counts?.proof_latency_s.median != null && (
          <Stat
            value={minutes(counts.proof_latency_s.median)}
            label="Median proof time"
            note={`${duration(counts.proof_latency_s.median)} from submit to QSTR post (PROOF.md)`}
          />
        )}
        <Stat
          value={num(rolledBack)}
          label="Submissions rolled back"
          note="Removed by upheld fraud proofs"
        />
      </div>

      <div className="overview-grid">
        <Ribbon rows={rows} onOpen={onOpen} />
        <Matrix rows={rows} onFilter={onFilter} />
      </div>

      <PendingWindows rows={rows} health={health} onOpen={onOpen} />
    </section>
  );
}

/** Whole minutes for the big number; the note carries the exact time. */
function minutes(s: number): string {
  return s < 120 ? `${s} s` : `${Math.round(s / 60)} min`;
}

export function Stat({ value, label, note }: { value: string; label: string; note: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="t-small-strong">{label}</span>
      <span className="t-caption">{note}</span>
    </div>
  );
}

/** Every batch in index order: top half settlement, bottom half validity. */
function Ribbon({ rows, onOpen }: { rows: BatchRow[]; onOpen: (i: string) => void }) {
  const { tier } = useRollup();
  const ax = axis(tier);
  const shown = rows.slice(-160);
  return (
    <div className="card card-pad ribbon-card">
      <div className="card-head">
        <span className="card-title">Batch ribbon</span>
        <span className="t-caption">
          {rows.length > shown.length
            ? `Latest ${num(shown.length)} of ${num(rows.length)}`
            : `${rows.length} batches`}
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="t-small">No batches archived yet.</p>
      ) : (
        <div className="ribbon">
          {shown.map((r) => {
            const s = SETTLEMENT[r.settlement];
            const v = ax.of(r.validity);
            return (
              <button
                key={`${r.batch_index}:${r.submit_tx}`}
                type="button"
                className="ribbon-cell"
                onClick={() => onOpen(r.batch_index)}
                title={`Batch ${r.batch_index}: ${s.label}, ${v.label}`}
                aria-label={`Batch ${r.batch_index}, ${s.label}, ${v.label}`}
              >
                <span data-tone={s.tone} />
                <span data-tone={v.tone} />
              </button>
            );
          })}
        </div>
      )}
      <div className="legend">
        <span className="legend-group">
          <span className="legend-swatch legend-top" /> Settlement
        </span>
        <span className="legend-group">
          <span className="legend-swatch legend-bottom" /> {ax.name}
        </span>
        <span className="legend-group">
          <span className="dot" data-tone="ok" />{" "}
          {tier === "stark" ? "Final / Proven" : "Final / Match"}
        </span>
        <span className="legend-group">
          <span className="dot" data-tone="wait" />{" "}
          {tier === "stark" ? "Pending / Proving" : "Pending"}
        </span>
        {tier === "stark" && (
          <span className="legend-group">
            <span className="dot" data-tone="accent" /> Unproven
          </span>
        )}
        <span className="legend-group">
          <span className="dot" data-tone="bad" /> Void / Mismatch
        </span>
      </div>
    </div>
  );
}

/** Settlement x validity: how many batches sit in each pair of states. */
function Matrix({ rows, onFilter }: { rows: BatchRow[]; onFilter: (f: Partial<Filter>) => void }) {
  const ax = axis(useRollup().tier);
  const count = (s: Settlement, v: Validity) =>
    rows.filter((r) => r.settlement === s && r.validity === v).length;
  const max = Math.max(1, ...SETTLEMENT_ORDER.flatMap((s) => ax.order.map((v) => count(s, v))));
  const settlements = SETTLEMENT_ORDER.filter(
    (s) => s !== "unknown" || rows.some((r) => r.settlement === s),
  );
  return (
    <div className="card card-pad matrix-card">
      <div className="card-head">
        <span className="card-title">Two axes</span>
        <span className="t-caption">Select a cell to filter</span>
      </div>
      <div
        className="matrix"
        style={{ gridTemplateColumns: `auto repeat(${ax.order.length}, 1fr)` }}
      >
        <span />
        {ax.order.map((v) => (
          <span key={v} className="matrix-col t-caption">
            {ax.of(v).label}
          </span>
        ))}
        {settlements.map((s) => (
          <MatrixRow key={s} s={s} ax={ax} count={count} max={max} onFilter={onFilter} />
        ))}
      </div>
    </div>
  );
}

function MatrixRow(p: {
  s: Settlement;
  ax: ReturnType<typeof axis>;
  count: (s: Settlement, v: Validity) => number;
  max: number;
  onFilter: (f: Partial<Filter>) => void;
}) {
  return (
    <>
      <span className="matrix-row t-small">{SETTLEMENT[p.s].label}</span>
      {p.ax.order.map((v) => {
        const n = p.count(p.s, v);
        return (
          <button
            key={v}
            type="button"
            className="matrix-cell"
            data-empty={n === 0}
            style={{ "--share": n / p.max } as React.CSSProperties}
            onClick={() => p.onFilter({ settlement: p.s, validity: v, query: "" })}
            aria-label={`${n} batches ${SETTLEMENT[p.s].label} and ${p.ax.of(v).label}`}
          >
            {n}
          </button>
        );
      })}
    </>
  );
}

/** Batches still inside their challenge window, with time left. */
function PendingWindows(p: {
  rows: BatchRow[];
  health: ApiHealthV1 | undefined;
  onOpen: (i: string) => void;
}) {
  const pending = p.rows.filter((r) => r.settlement === "pending");
  const windowS = p.health?.challenge_window_s ? Number(p.health.challenge_window_s) : undefined;
  const now = useNow(1000, pending.length > 0);
  if (pending.length === 0 || windowS === undefined) return null;
  return (
    <div className="card card-pad windows-card">
      <div className="card-head">
        <span className="card-title">
          <Hourglass size={14} aria-hidden="true" /> Challenge windows open
        </span>
        <span className="t-caption">Window {duration(windowS)}</span>
      </div>
      <div className="windows">
        {pending.map((r) => {
          const start = r.submitted_time ? Date.parse(r.submitted_time) : undefined;
          const left = start === undefined ? undefined : (start + windowS * 1000 - now) / 1000;
          const share = left === undefined ? 0 : Math.min(1, Math.max(0, 1 - left / windowS));
          return (
            <button
              key={r.batch_index}
              type="button"
              className="window"
              onClick={() => p.onOpen(r.batch_index)}
            >
              <Ring share={share} />
              <span className="window-text">
                <span className="t-body-strong">Batch {r.batch_index}</span>
                <span className="t-small">
                  {left === undefined
                    ? "Submission time unknown"
                    : left > 0
                      ? `${duration(left)} left`
                      : "Finalizing"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Ring({ share }: { share: number }) {
  const r = 16;
  const c = 2 * Math.PI * r;
  return (
    <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r={r} fill="none" stroke="var(--base-12)" strokeWidth="3" />
      <circle
        cx="20"
        cy="20"
        r={r}
        fill="none"
        stroke="var(--fill)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray={`${c * share} ${c}`}
        transform="rotate(-90 20 20)"
      />
    </svg>
  );
}
