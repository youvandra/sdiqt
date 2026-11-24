import type { ApiBatchListV1 } from "@sdiqt/protocol";
import { Link } from "react-router";
import { Badge, CheckCell } from "../components/Status.tsx";
import { api, usePolled } from "../lib/api.ts";
import { ago, entries, SETTLEMENT, VALIDITY } from "../lib/format.ts";
import "./batches.css";

type Row = ApiBatchListV1["batches"][number];

const GROUPS: Array<{ key: Row["settlement"]; title: string }> = [
  { key: "pending", title: "Pending settlement" },
  { key: "final", title: "Final" },
  { key: "rejected", title: "Void" },
  { key: "unknown", title: "Unknown" },
];

export function Batches() {
  const list = usePolled((s) => api.batches(s), "batches");
  const health = usePolled((s) => api.health(s), "health");
  const rows = [...(list.data?.batches ?? [])].reverse();
  const proven = rows.filter((r) => r.validity === "proven").length;
  const final = rows.filter((r) => r.settlement === "final").length;
  const h = health.data;

  return (
    <section className="section batches">
      <div className="section-title">
        <span className="eyebrow">Batches</span>
        <h1 className="t-h2">Every batch, checked twice.</h1>
        <p className="t-body">
          Each batch is re-executed from the rollup inbox and proven with a STARK. Settlement comes
          from QoreChain, validity comes from the proof.
        </p>
      </div>

      <div className="stats">
        <Stat value={String(rows.length)} label="Batches" />
        <Stat value={String(proven)} label="Proven" />
        <Stat value={String(final)} label="Final on QoreChain" />
        <Stat
          value={h?.last_poll_at ? ago(h.last_poll_at) : "Offline"}
          label={
            h ? `Tower ${h.status === "ok" ? "online" : "stale"}, rollup ${h.rollup_id}` : "Tower"
          }
        />
      </div>

      {list.error && !list.data && (
        <p className="t-body notice" role="alert">
          The watchtower API is unreachable: {list.error}
        </p>
      )}
      {list.data && rows.length === 0 && <p className="t-body notice">No batches archived yet.</p>}

      {rows.length > 0 && (
        <div className="btable">
          <div className="btable-head">
            <div className="btable-spacer">
              <span className="t-small">Batch</span>
            </div>
            <HeadCard title="Re-execution" note="Same roots as the chain" />
            <HeadCard title="Proof" note="STARK over the batch" />
            <HeadCard title="Settlement" note="Read from QoreChain" />
          </div>
          {GROUPS.map((g) => {
            const inGroup = rows.filter((r) => r.settlement === g.key);
            if (inGroup.length === 0) return null;
            return (
              <div className="btable-group" key={g.key}>
                <div className="btable-bar t-body-strong">
                  {g.title}
                  <span className="t-small">{inGroup.length}</span>
                </div>
                {inGroup.map((r) => (
                  <BatchRow key={`${r.batch_index}:${r.submit_tx}`} r={r} />
                ))}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="t-small">{label}</span>
    </div>
  );
}

function HeadCard({ title, note }: { title: string; note: string }) {
  return (
    <div className="btable-headcard">
      <span className="t-large">{title}</span>
      <span className="t-small">{note}</span>
    </div>
  );
}

function BatchRow({ r }: { r: Row }) {
  const s = SETTLEMENT[r.settlement];
  const v = VALIDITY[r.validity];
  return (
    <Link className="btable-row" to={`/batches/${r.batch_index}`}>
      <div className="btable-cell btable-title">
        <span className="t-body-strong">Batch {r.batch_index}</span>
        <span className="t-small">
          {entries(r.inbox_from, r.inbox_end)}
          {r.submissions !== "1" ? `, ${r.submissions} submissions` : ""}
        </span>
      </div>
      <div className="btable-cell">
        <CheckCell ok={r.judged === "match"} label={r.judged === "match" ? "Match" : "Mismatch"} />
      </div>
      <div className="btable-cell">
        <Badge tone={v.tone}>{v.label}</Badge>
      </div>
      <div className="btable-cell">
        <Badge tone={s.tone}>{s.label}</Badge>
      </div>
    </Link>
  );
}
