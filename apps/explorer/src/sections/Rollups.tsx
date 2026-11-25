import type { ApiRollupListV1, ApiRollupSummaryV1 } from "@sdiqt/protocol";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { Badge, SectionHead } from "../components/Ui.tsx";
import { ago, num, SETTLEMENT } from "../lib/format.ts";
import { rollupPath } from "../lib/rollup.ts";
import { Stat } from "./Overview.tsx";

interface Props {
  list: ApiRollupListV1 | undefined;
  loading: boolean;
  error: string | undefined;
}

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 1000) / 10}%` : "No batches");

/** Every qledger-v1 rollup on QoreChain diana, with what SDIQT checked on each. */
export function Rollups({ list, loading, error }: Props) {
  const rows = list?.rollups ?? [];
  const batches = rows.reduce((n, r) => n + Number(r.batches), 0);
  const match = rows.reduce((n, r) => n + Number(r.match), 0);
  const found = rows.reduce((n, r) => n + Number(r.mismatches_total), 0);
  const voided = rows.reduce((n, r) => n + Number(r.mismatches_rejected), 0);

  return (
    <section className="section" id="rollups" aria-labelledby="rollups-title">
      <SectionHead eyebrow="Rollups" title="Every qledger rollup on QoreChain." id="rollups-title">
        Each qledger-v1 rollup with a based inbox posts every entry on chain, so SDIQT re-executes
        all of them with no integration. sdiqt-1 is the reference: every batch there also carries a
        STARK proof.
      </SectionHead>

      {rows.length > 0 && (
        <div className="card stats-card">
          <Stat value={num(rows.length)} label="Rollups watched" note="qledger-v1, based inbox" />
          <Stat
            value={num(batches)}
            label="Batches re-executed"
            note="Current submission per index"
          />
          <Stat
            value={pct(match, batches)}
            label="Re-execution match"
            note={`${num(match)} of ${num(batches)} batches`}
          />
          <Stat
            value={num(found)}
            label="Mismatches found"
            note={
              found ? `${num(voided)} voided by QoreChain` : "Every batch gives the chain's roots"
            }
          />
        </div>
      )}

      <div className="rtable">
        <div className="rtable-head" aria-hidden="true">
          <span>Rollup</span>
          <span>Checked</span>
          <span className="c-right">Batches</span>
          <span className="c-right">Match</span>
          <span>Last mismatch</span>
          <span>Last active</span>
          <span aria-hidden="true" />
        </div>
        {error && rows.length === 0 && (
          <div className="notice" data-tone="bad" role="alert">
            The watchtower API is unreachable: {error}
          </div>
        )}
        {loading && rows.length === 0 && !error && (
          <div className="btable-empty" aria-live="polite">
            <p className="t-body">Reading rollups from the watchtower</p>
          </div>
        )}
        <ul className="btable-list" aria-label="Rollups">
          {rows.map((r) => (
            <li key={r.rollup_id}>
              <Row r={r} />
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Row({ r }: { r: ApiRollupSummaryV1 }) {
  const stark = r.tier === "stark";
  const batches = Number(r.batches);
  const first = r.last_poll_at === null;
  return (
    <Link to={rollupPath(r.rollup_id)} className="rtable-row">
      <span className="c-batch">
        <span className="t-body-strong t-mono">{r.rollup_id}</span>
        {stark && <span className="c-sub">Fully proven reference</span>}
      </span>
      <span>
        <Badge
          tone={stark ? "ok" : "accent"}
          title={
            stark
              ? "Re-executed and proven by a STARK, receipts signed"
              : "Re-executed from the public inbox, receipts signed"
          }
        >
          {stark ? "STARK + Re-execution" : "Re-execution"}
        </Badge>
        {stark && <span className="c-sub">{num(r.proven)} proven</span>}
      </span>
      <span className="c-right c-num t-small">
        <span className="m-only c-sub">Batches</span>
        {first ? "First pass" : num(r.batches)}
        {!first && r.submissions !== r.batches && (
          <span className="c-sub">{num(Number(r.submissions) - batches)} replaced</span>
        )}
      </span>
      <span className="c-right c-num t-small">
        <span className="m-only c-sub">Re-execution match</span>
        {first ? "" : pct(Number(r.match), batches)}
        {!first && batches > 0 && <span className="c-sub">{num(r.match)} batches</span>}
      </span>
      <span className="t-small">
        <span className="m-only c-sub">Last mismatch</span>
        {r.last_mismatch ? (
          <>
            Batch {r.last_mismatch.batch_index}
            <span className="c-sub">
              {SETTLEMENT[r.last_mismatch.settlement].label} on QoreChain
            </span>
          </>
        ) : (
          <span className="c-muted">{first ? "" : "None found"}</span>
        )}
      </span>
      <span className="t-small">
        <span className="m-only c-sub">Last active</span>
        {r.last_submitted_time ? ago(r.last_submitted_time) : "No batches yet"}
        {Number(r.submissions_24h) > 0 && (
          <span className="c-sub">{num(r.submissions_24h)} in 24 h</span>
        )}
      </span>
      <span className="c-chev" aria-hidden="true">
        <ChevronRight size={18} />
      </span>
    </Link>
  );
}
