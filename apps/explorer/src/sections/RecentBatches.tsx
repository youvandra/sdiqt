import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { Status } from "../components/Ui.tsx";
import type { Fleet } from "../lib/fleet.ts";
import {
  absolute,
  ago,
  axis,
  type BatchRow,
  entries,
  SETTLEMENT,
  shortHash,
} from "../lib/format.ts";
import { rollupPath } from "../lib/rollup.ts";

const SHOWN = 20;

interface Item {
  rollup: string;
  row: BatchRow;
}

/** Does a batch match the search: rollup id, "#12" or "12", or a tx hash prefix. */
function hit(it: Item, q: string): boolean {
  if (q === "") return true;
  const n = q.replace(/^#/, "");
  return (
    it.rollup.toLowerCase().includes(q) ||
    (/^[0-9]+$/.test(n) && it.row.batch_index === n) ||
    (q.length >= 4 && it.row.submit_tx.toLowerCase().startsWith(q))
  );
}

/** Newest batches across every rollup; each opens in its rollup page's drawer. */
export function RecentBatches({
  fleet,
  reference,
  query,
}: {
  fleet: Fleet | undefined;
  reference: string;
  query: string;
}) {
  const q = query.trim().toLowerCase();
  const items: Item[] = [];
  for (const [rollup, rows] of fleet?.byRollup ?? [])
    for (const row of rows) items.push({ rollup, row });
  const time = (it: Item) => (it.row.submitted_time ? Date.parse(it.row.submitted_time) : 0);
  const shown = items
    .filter((it) => hit(it, q))
    .sort((a, b) => time(b) - time(a))
    .slice(0, SHOWN);

  return (
    <div className="feed">
      {!fleet && <p className="t-small feed-empty">Reading</p>}
      {fleet && shown.length === 0 && (
        <p className="t-small feed-empty">No batch matches this search.</p>
      )}
      <ul className="btable-list" aria-label="Recent batches">
        {shown.map((it) => (
          <li key={`${it.rollup}:${it.row.batch_index}:${it.row.submit_tx}`}>
            <FeedRow it={it} stark={it.rollup === reference} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function FeedRow({ it, stark }: { it: Item; stark: boolean }) {
  const { row: r } = it;
  const s = SETTLEMENT[r.settlement];
  const v = axis(stark ? "stark" : "reexec").of(r.validity);
  const quietV = stark ? r.validity === "proven" : r.validity === "unproven";
  return (
    <Link to={rollupPath(it.rollup, r.batch_index)} className="feed-row">
      <span className="c-batch">
        <span className="t-body-strong t-mono">{it.rollup}</span>
        <span className="c-sub">
          #{r.batch_index} · {shortHash(r.submit_tx, 6, 4)}
        </span>
      </span>
      <span className="t-small" title={r.submitted_time ? absolute(r.submitted_time) : undefined}>
        {r.submitted_time ? ago(r.submitted_time) : "Unknown"}
        <span className="c-sub">{entries(r.inbox_from, r.inbox_end)}</span>
      </span>
      <span>
        <Status tone={v.tone} label={v.label} hint={v.hint} quiet={quietV} />
      </span>
      <span>
        <Status tone={s.tone} label={s.label} hint={s.hint} quiet={r.settlement === "final"} />
      </span>
      <span className="c-chev" aria-hidden="true">
        <ChevronRight size={18} />
      </span>
      <span className="m-line t-caption">
        {[`#${r.batch_index}`, v.label, s.label, r.submitted_time ? ago(r.submitted_time) : ""]
          .filter(Boolean)
          .join(" · ")}
      </span>
    </Link>
  );
}
