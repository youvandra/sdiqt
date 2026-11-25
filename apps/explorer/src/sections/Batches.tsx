import { Check, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, SectionHead, Segmented } from "../components/Ui.tsx";
import { type Filter, matches, NO_FILTER } from "../lib/filters.ts";
import {
  absolute,
  ago,
  type BatchRow,
  entries,
  num,
  SETTLEMENT,
  SETTLEMENT_ORDER,
  shortHash,
  VALIDITY,
  VALIDITY_ORDER,
} from "../lib/format.ts";

const PAGE = 25;

interface Props {
  rows: BatchRow[];
  loading: boolean;
  error: string | undefined;
  filter: Filter;
  setFilter: (f: Partial<Filter>) => void;
  onOpen: (index: string) => void;
}

export function Batches({ rows, loading, error, filter, setFilter, onOpen }: Props) {
  const [limit, setLimit] = useState(PAGE);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new filter starts at the first page
  useEffect(() => setLimit(PAGE), [filter.settlement, filter.validity, filter.query]);

  const newestFirst = [...rows].reverse();
  const shown = newestFirst.filter((r) => matches(r, filter));
  const filtered = filter.settlement !== "all" || filter.validity !== "all" || filter.query !== "";

  return (
    <section className="section" id="batches" aria-labelledby="batches-title">
      <SectionHead eyebrow="Batches" title="Every batch, checked twice." id="batches-title">
        Newest first. Open a batch to compare its chain roots with the re-execution and the proof
        claim, and to read its signed receipts.
      </SectionHead>

      <div className="toolbar">
        <Segmented
          label="Settlement"
          value={filter.settlement}
          onChange={(v) => setFilter({ settlement: v })}
          options={[
            { value: "all", label: "All", count: rows.length },
            ...SETTLEMENT_ORDER.filter((s) => rows.some((r) => r.settlement === s)).map((s) => ({
              value: s,
              label: SETTLEMENT[s].label,
              count: rows.filter((r) => r.settlement === s).length,
            })),
          ]}
        />
        <Segmented
          label="Proof"
          value={filter.validity}
          onChange={(v) => setFilter({ validity: v })}
          options={[
            { value: "all", label: "Any Proof" },
            ...VALIDITY_ORDER.filter((v) => rows.some((r) => r.validity === v)).map((v) => ({
              value: v,
              label: VALIDITY[v].label,
              count: rows.filter((r) => r.validity === v).length,
            })),
          ]}
        />
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Batch number or tx hash"
            value={filter.query}
            onChange={(e) => setFilter({ query: e.target.value })}
            aria-label="Search batches"
          />
        </label>
      </div>

      <div className="btable">
        <div className="btable-head" aria-hidden="true">
          <span>Batch</span>
          <span>Inbox</span>
          <span>Submitted</span>
          <span className="c-center">Re-execution</span>
          <span>Proof</span>
          <span>Settlement</span>
          <span aria-hidden="true" />
        </div>

        {error && rows.length === 0 && (
          <div className="notice" data-tone="bad" role="alert">
            The watchtower API is unreachable: {error}
          </div>
        )}
        {loading && rows.length === 0 && !error && <SkeletonRows />}
        {!loading && !error && shown.length === 0 && (
          <div className="btable-empty">
            <p className="t-body">
              {filtered ? "No batch matches this filter." : "No batches archived yet."}
            </p>
            {filtered && (
              <button
                type="button"
                className="btn btn-sm btn-secondary"
                onClick={() => setFilter(NO_FILTER)}
              >
                Clear Filters
              </button>
            )}
          </div>
        )}

        <ul className="btable-list" aria-label="Batches">
          {shown.slice(0, limit).map((r) => (
            <li key={`${r.batch_index}:${r.submit_tx}`}>
              <Row r={r} onOpen={onOpen} />
            </li>
          ))}
        </ul>
      </div>

      {shown.length > 0 && (
        <div className="table-foot">
          <span className="t-small">
            Showing {num(Math.min(limit, shown.length))} of {num(shown.length)}
            {filtered ? ` (filtered from ${num(rows.length)})` : ""}
          </span>
          {shown.length > limit && (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setLimit((l) => l + PAGE)}
            >
              Show More
            </button>
          )}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {shown.length} batches shown
      </span>
    </section>
  );
}

function Row({ r, onOpen }: { r: BatchRow; onOpen: (i: string) => void }) {
  const s = SETTLEMENT[r.settlement];
  const v = VALIDITY[r.validity];
  const match = r.judged === "match";
  return (
    <button type="button" className="btable-row" onClick={() => onOpen(r.batch_index)}>
      <span className="c-batch">
        <span className="t-body-strong">#{r.batch_index}</span>
        <span className="t-mono c-tx">{shortHash(r.submit_tx, 6, 4)}</span>
      </span>
      <span className="t-small c-num">
        {r.inbox_from} to {r.inbox_end}
        <span className="c-sub">{entries(r.inbox_from, r.inbox_end)}</span>
      </span>
      <span className="t-small" title={r.submitted_time ? absolute(r.submitted_time) : undefined}>
        {r.submitted_time ? ago(r.submitted_time) : "Unknown"}
        <span className="c-sub">Height {num(r.submit_height)}</span>
      </span>
      <span
        className="c-center"
        title={match ? "Same roots as the chain" : "Roots differ from the chain"}
      >
        {match ? (
          <Check size={20} aria-label="Match" />
        ) : (
          <X size={20} aria-label="Mismatch" className="c-bad" />
        )}
      </span>
      <span>
        <Badge tone={v.tone} title={v.hint}>
          {v.label}
        </Badge>
      </span>
      <span>
        <Badge tone={s.tone} title={s.hint}>
          {s.label}
        </Badge>
        {r.submissions !== "1" && (
          <span className="c-sub">{Number(r.submissions) - 1} rolled back</span>
        )}
      </span>
      <span className="c-chev" aria-hidden="true">
        <ChevronRight size={18} />
      </span>
    </button>
  );
}

function SkeletonRows() {
  return (
    <div className="btable-empty" aria-live="polite">
      <p className="t-body">Reading batches from the watchtower</p>
    </div>
  );
}
