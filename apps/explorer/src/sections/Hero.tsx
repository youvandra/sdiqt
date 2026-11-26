import type { ApiHealthV1, ApiRollupListV1, CountsV1 } from "@sdiqt/protocol";
import { ArrowUpRight } from "lucide-react";
import { Link } from "react-router";
import { ago, duration, num, SETTLEMENT, VALIDITY } from "../lib/format.ts";
import { PROOF_URL } from "../lib/links.ts";

/** One quiet line under the actions: tower, rollup, block, latest batch, last check. */
function LiveStatus({
  health,
  error,
}: {
  health: ApiHealthV1 | undefined;
  error: string | undefined;
}) {
  if (!health) {
    return (
      <p className="live" data-tone={error ? "bad" : "wait"}>
        <span className="dot" aria-hidden="true" />
        <span>{error ? "Watchtower unreachable" : "Reading the watchtower"}</span>
      </p>
    );
  }
  const ok = health.status === "ok";
  const last = health.last_receipt;
  const parts = [
    `Rollup ${health.rollup_id}`,
    health.last_poll_height ? `Block ${num(health.last_poll_height)}` : undefined,
    last
      ? `Batch ${last.batch_index} ${VALIDITY[last.validity].label.toLowerCase()}, ${
          last.settlement === "pending"
            ? "settling"
            : SETTLEMENT[last.settlement].label.toLowerCase()
        }`
      : undefined,
    health.last_poll_at ? `Checked ${ago(health.last_poll_at)}` : undefined,
  ].filter((s): s is string => s !== undefined);
  return (
    <p className="live" data-tone={ok ? "ok" : "bad"}>
      <span className="dot" aria-hidden="true" />
      <span className="live-strong">{ok ? "Watchtower online" : "Watchtower behind"}</span>
      {parts.map((s) => (
        <span key={s} className="live-part">
          {s}
        </span>
      ))}
    </p>
  );
}

interface Props {
  health: ApiHealthV1 | undefined;
  error: string | undefined;
  rollups: ApiRollupListV1 | undefined;
  counts: CountsV1 | null;
}

export function Hero(p: Props) {
  const n = p.rollups?.rollups.length;
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero-image" aria-hidden="true" />
      <div className="hero-inner">
        <div className="hero-content">
          <h1 className="t-h1 hero-heading" id="hero-title">
            Proof that outlives
            <br />
            the chain.
          </h1>
          <p className="t-large hero-sub">
            SDIQT gives every batch of a QoreChain rollup a hash-based STARK proof that your browser
            checks in milliseconds, long after the chain prunes the batch. Its post-quantum
            watchtower also re-executes {n ? num(n) : "every"} rollups and signs a receipt for every
            batch.
          </p>
          <div className="hero-actions">
            <Link to="/#verify" className="btn btn-accent">
              Verify a Proof
            </Link>
            <a className="btn btn-primary" href={PROOF_URL} target="_blank" rel="noreferrer">
              See the Evidence
              <ArrowUpRight size={16} aria-hidden="true" />
            </a>
          </div>
          <LiveStatus health={p.health} error={p.error} />
        </div>
        <ProofStrip rollups={p.rollups} counts={p.counts} />
      </div>
    </section>
  );
}

/** The four facts a judge checks first, each linked to its row in PROOF.md. */
function ProofStrip({
  rollups,
  counts,
}: {
  rollups: ApiRollupListV1 | undefined;
  counts: CountsV1 | null;
}) {
  const rows = rollups?.rollups ?? [];
  const reference = rows.find((r) => r.tier === "stark");
  const wrong = rows.reduce((t, r) => t + Number(r.mismatches_total), 0);
  const rejected = rows.reduce((t, r) => t + Number(r.mismatches_rejected), 0);
  const batches = rows.reduce((t, r) => t + Number(r.batches), 0);
  const median = counts?.proof_latency_s.median;

  const tiles = [
    {
      value: reference ? (
        <>
          {num(reference.proven)}
          <span className="tile-unit">/{num(reference.batches)}</span>
        </>
      ) : undefined,
      label: "Batches Proven",
      note:
        median != null
          ? `sdiqt-1, median ${duration(median)} from batch to proof`
          : "Every current sdiqt-1 batch",
      href: `${PROOF_URL}#batches`,
    },
    {
      value: "7 s",
      label: "Staged Fraud Rejected",
      note: "Wrong root in batch 12, operator bond slashed",
      href: `${PROOF_URL}#setup-on-chain`,
    },
    {
      value: (
        <>
          2.5<span className="tile-unit"> QOR</span>
        </>
      ),
      label: "Sealed Exit Paid",
      note: "Withdrawal sealed to the watchtower's ML-KEM-1024 key",
      href: `${PROOF_URL}#setup-on-chain`,
    },
    {
      value:
        rows.length > 0 ? (
          <>
            {num(rejected)}
            <span className="tile-unit">/{num(wrong)}</span>
          </>
        ) : undefined,
      label: "Wrong Roots Rejected",
      note:
        rows.length > 0
          ? `Across ${num(rows.length)} rollups and ${num(batches)} batches`
          : "Across every watched rollup",
      href: "/rollups",
    },
  ];

  return (
    <ul className="proof-strip" aria-label="Evidence">
      {tiles.map((t) => {
        const external = t.href.startsWith("http");
        const body = (
          <>
            <span className="tile-value">
              {t.value ?? <span className="tile-reading">Reading</span>}
            </span>
            <span className="t-small-strong">{t.label}</span>
            <span className="t-caption">{t.note}</span>
          </>
        );
        return (
          <li key={t.label}>
            {external ? (
              <a className="tile" href={t.href} target="_blank" rel="noreferrer">
                {body}
              </a>
            ) : (
              <Link className="tile" to={t.href}>
                {body}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}
