import type { ApiHealthV1 } from "@sdiqt/protocol";
import { ArrowLeft, Hourglass } from "lucide-react";
import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { Badge } from "../components/Ui.tsx";
import { api, usePolled } from "../lib/api.ts";
import { SITE, useDocumentTitle } from "../lib/dom.ts";
import { type Filter, NO_FILTER } from "../lib/filters.ts";
import { ago, type BatchRow, duration, num } from "../lib/format.ts";
import { RollupProvider, type RollupView, viewOf } from "../lib/rollup.ts";
import { useNow } from "../lib/useNow.ts";
import { Batches } from "../sections/Batches.tsx";
import { Overview } from "../sections/Overview.tsx";
import { NotFound } from "./NotFound.tsx";

/** The drawer and its proof tools load only when a batch is opened. */
const BatchDrawer = lazy(() =>
  import("../detail/BatchDrawer.tsx").then((m) => ({ default: m.BatchDrawer })),
);

/** One rich page per rollup; `?batch=N` opens the batch drawer. */
export function Rollup() {
  const { id = "" } = useParams();
  const view = useMemo(() => viewOf(id), [id]);
  return (
    <RollupProvider value={view}>
      <RollupPage key={id} view={view} />
    </RollupProvider>
  );
}

function RollupPage({ view }: { view: RollupView }) {
  const stark = view.tier === "stark";
  const health = usePolled(view.api.health, `health:${view.id}`);
  const list = usePolled(view.api.batches, `batches:${view.id}`);
  const counts = usePolled(
    async (s) => (stark ? api.counts(s) : null),
    `counts:${view.id}`,
    60_000,
  );
  const all = usePolled(api.rollups, "rollups", 30_000);
  const summary = all.data?.rollups.find((r) => r.rollup_id === view.id);
  const rows = list.data?.batches ?? [];
  const [filter, setFilterState] = useState<Filter>(NO_FILTER);
  const [params, setParams] = useSearchParams();
  const open = params.get("batch");
  const verify = params.get("verify") === "1";

  const setFilter = useCallback(
    (f: Partial<Filter>) => setFilterState((cur) => ({ ...cur, ...f })),
    [],
  );
  const filterAndShow = useCallback(
    (f: Partial<Filter>) => {
      setFilter(f);
      document.getElementById("batches")?.scrollIntoView({ behavior: "smooth" });
    },
    [setFilter],
  );
  const onOpen = useCallback(
    (i: string) =>
      setParams(
        (p) => {
          p.set("batch", i);
          return p;
        },
        { preventScrollReset: true },
      ),
    [setParams],
  );
  const onClose = useCallback(
    () =>
      setParams(
        (p) => {
          p.delete("batch");
          p.delete("verify");
          return p;
        },
        { preventScrollReset: true },
      ),
    [setParams],
  );

  // A rollup the towers do not watch answers 404; say so instead of an empty page.
  const missing = !health.data && health.error !== undefined && /not watched/.test(health.error);
  if (missing) return <NotFound />;

  return (
    <>
      <RollupHead view={view} health={health.data} error={health.error} rows={rows} />
      <Overview
        rows={rows}
        loading={list.loading}
        counts={counts.data ?? null}
        summary={summary}
        health={health.data}
        onOpen={onOpen}
        onFilter={filterAndShow}
      />
      <Batches
        rows={rows}
        loading={list.loading}
        error={list.error}
        filter={filter}
        setFilter={setFilter}
        onOpen={onOpen}
      />
      {open !== null && /^[0-9]+$/.test(open) && (
        <Suspense fallback={null}>
          <BatchDrawer key={`${open}:${verify}`} index={open} onClose={onClose} verify={verify} />
        </Suspense>
      )}
    </>
  );
}

function RollupHead(p: {
  view: RollupView;
  health: ApiHealthV1 | undefined;
  error: string | undefined;
  rows: BatchRow[];
}) {
  const stark = p.view.tier === "stark";
  const h = p.health;
  // Set here, before the drawer below it, so the drawer's title restores to this one.
  useDocumentTitle(`${p.view.id} · ${SITE}`);
  const pending = p.rows.filter((r) => r.settlement === "pending");
  return (
    <section className="section rollup-head" aria-labelledby="rollup-title">
      <Link to="/rollups" className="rollup-back t-small">
        <ArrowLeft size={14} aria-hidden="true" /> All Rollups
      </Link>
      <div className="rollup-head-grid">
        <div className="rollup-head-text">
          <div className="rollup-title">
            <h1 className="t-h2" id="rollup-title">
              {p.view.id}
            </h1>
            <Badge tone={stark ? "ok" : "accent"}>
              {stark ? "STARK + Re-executed" : "Re-executed"}
            </Badge>
          </div>
          <p className="t-body">
            {stark
              ? "The rollup SDIQT runs. Every current batch is re-executed, proven by a STARK and given a signed receipt."
              : "A qledger-v1 rollup run by another team. SDIQT re-executes each batch from chain data and signs a receipt."}
          </p>
        </div>
        <div className="rollup-facts t-small">
          {h ? (
            <>
              <span className="rollup-fact" data-tone={h.status === "ok" ? "ok" : "bad"}>
                <span className="dot" aria-hidden="true" />
                {h.status === "ok" ? "Watchtower online" : "Watchtower behind"}
                {h.last_poll_at && <span className="c-sub-inline">{ago(h.last_poll_at)}</span>}
              </span>
              {h.last_poll_height && <span>Block {num(h.last_poll_height)}</span>}
              {h.challenge_window_s && (
                <span>Challenge window {duration(Number(h.challenge_window_s))}</span>
              )}
              {pending.length === 1 && pending[0] && h.challenge_window_s && (
                <WindowLeft row={pending[0]} windowS={Number(h.challenge_window_s)} />
              )}
            </>
          ) : (
            <span title={p.error}>
              {p.error ? "The watchtower is unreachable right now." : "Reading the watchtower"}
            </span>
          )}
        </div>
      </div>
    </section>
  );
}

/** "Batch 16 settles in 36 min" for the one batch still in its challenge window. */
function WindowLeft({ row, windowS }: { row: BatchRow; windowS: number }) {
  const now = useNow(1000, true);
  if (!row.submitted_time) return null;
  const left = (Date.parse(row.submitted_time) + windowS * 1000 - now) / 1000;
  return (
    <span className="rollup-fact" data-tone="wait">
      <Hourglass size={14} aria-hidden="true" />
      Batch {row.batch_index} {left > 0 ? `settles in ${duration(left)}` : "is finalizing"}
    </span>
  );
}
