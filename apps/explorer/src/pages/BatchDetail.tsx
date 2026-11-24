import type { ApiBatchDetailV1 } from "@sdiqt/protocol";
import { Link, useParams } from "react-router";
import { Badge, CheckCell } from "../components/Status.tsx";
import { api, usePolled } from "../lib/api.ts";
import { entries, SETTLEMENT, shortHash, VALIDITY } from "../lib/format.ts";
import "./batches.css";

type Submission = ApiBatchDetailV1["submissions"][number];

export function BatchDetail() {
  const { index = "" } = useParams();
  const detail = usePolled((s) => api.batch(index, s), `batch:${index}`);
  const subs = detail.data?.submissions ?? [];
  const current = subs.at(-1);

  return (
    <section className="section batches">
      <div className="section-title">
        <Link to="/batches" className="eyebrow">
          Batches
        </Link>
        <h1 className="t-h2">Batch {index}</h1>
        {current && (
          <p className="t-body">
            {entries(current.inbox_from, current.inbox_end)} from the inbox, submitted at height{" "}
            {current.submit_height}.
          </p>
        )}
      </div>
      {detail.error && !detail.data && (
        <p className="t-body notice" role="alert">
          {detail.error}
        </p>
      )}
      {[...subs].reverse().map((s, i) => (
        <SubmissionCard key={s.submit_tx} s={s} current={i === 0} />
      ))}
    </section>
  );
}

function SubmissionCard({ s, current }: { s: Submission; current: boolean }) {
  const st = SETTLEMENT[s.settlement];
  const v = VALIDITY[s.validity];
  return (
    <article className={`card detail-card${current ? " card-featured" : ""}`}>
      <header className="detail-head">
        <span className="t-large">{current ? "Current submission" : "Earlier submission"}</span>
        <span className="detail-badges">
          <Badge tone={v.tone}>{v.label}</Badge>
          <Badge tone={st.tone}>{st.label}</Badge>
        </span>
      </header>
      <dl className="detail-fields">
        <Field label="Submit tx" value={shortHash(s.submit_tx)} full={s.submit_tx} />
        <Field label="Submitter" value={shortHash(s.submitter, 10, 6)} full={s.submitter} />
        <Field
          label="Re-execution"
          value={
            s.judged === "match" ? "Same roots as the chain" : `Differs: ${s.differs.join(", ")}`
          }
          icon={<CheckCell ok={s.judged === "match"} label={s.judged} />}
        />
        {s.chain && (
          <Field
            label="State root"
            value={shortHash(s.chain.state_root)}
            full={s.chain.state_root}
          />
        )}
        {s.claim && (
          <Field
            label="Proof root"
            value={shortHash(s.claim.proof_root)}
            full={s.claim.proof_root}
          />
        )}
        {s.qstr_tx && <Field label="QSTR tx" value={shortHash(s.qstr_tx)} full={s.qstr_tx} />}
        {s.note && <Field label="Note" value={s.note} />}
      </dl>
    </article>
  );
}

function Field(p: { label: string; value: string; full?: string; icon?: React.ReactNode }) {
  return (
    <div className="detail-field">
      <dt className="t-small">{p.label}</dt>
      <dd className={p.full ? "t-mono" : "t-body"} title={p.full}>
        {p.icon}
        {p.value}
      </dd>
    </div>
  );
}
