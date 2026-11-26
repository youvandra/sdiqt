import type { ApiHealthV1, CountsV1 } from "@sdiqt/protocol";
import { SectionHead } from "../components/Ui.tsx";
import { ago, type BatchRow, entryCount, num } from "../lib/format.ts";

interface Step {
  title: string;
  body: string;
  metric: string;
  unit: string;
  keys: string;
}

export function HowItWorks({
  rows,
  health,
  counts,
}: {
  rows: BatchRow[];
  health: ApiHealthV1 | undefined;
  counts: CountsV1 | null;
}) {
  const reading = rows.length === 0;
  const entriesTotal = rows.reduce((n, r) => n + entryCount(r.inbox_from, r.inbox_end), 0);
  const matched = rows.filter((r) => r.judged === "match").length;
  const proven = rows.filter((r) => r.validity === "proven").length;
  const last = health?.last_receipt;
  const live = (v: string) => (reading ? "Reading" : v);

  const steps: Step[] = [
    {
      title: "Users Sign",
      body: "Users post deposits, transfers and withdrawals to the rollup inbox. SDIQT archives every entry.",
      metric: live(num(entriesTotal)),
      unit: "entries archived",
      keys: "ML-DSA-44",
    },
    {
      title: "Operator Submits",
      body: "The operator anchors a batch, backed by a 1,000 QOR bond. A 3,600 s challenge window opens.",
      metric: live(num(rows.length)),
      unit: "batches",
      keys: "ML-DSA-87",
    },
    {
      title: "Prover Proves",
      body: "SP1 re-executes the batch, checks every signature inside the proof and posts a 300-byte QSTR commitment.",
      metric: live(num(proven)),
      unit: "proven by a STARK",
      keys: "Hash-based STARK",
    },
    {
      title: "Watchtower Checks",
      body: "A separate watchtower re-executes the batch, verifies the bundle and signs a receipt. A wrong root is open to a fraud proof.",
      metric: live(`${num(matched)}/${num(rows.length)}`),
      unit: "roots match",
      keys: "ML-DSA-87",
    },
    {
      title: "Users Exit",
      body: "A final batch pays withdrawals. An offline user seals a withdrawal to the watchtower, which posts it at the chosen block.",
      metric: counts ? num(counts.withdrawals) : "2",
      unit: "withdrawals paid",
      keys: "ML-KEM-1024",
    },
    {
      title: "Anyone Verifies",
      body: "The bundle verifies in a browser or a CLI, after QoreChain prunes the batch.",
      metric: last ? ago(last.issued_at) : live("None yet"),
      unit: "last receipt",
      keys: "Open verifier",
    },
  ];

  return (
    <section className="section how" id="how-it-works" aria-labelledby="how-title">
      <SectionHead
        eyebrow="How It Works"
        title="One batch, from signature to proof."
        id="how-title"
      >
        One batch on sdiqt-1, from a user's signed entry to a proof anyone checks. The numbers are
        live.
      </SectionHead>
      <ol className="flow">
        {steps.map((s, i) => (
          <li key={s.title} className="flow-step">
            <span className="flow-num t-mono">{String(i + 1).padStart(2, "0")}</span>
            <span className="flow-metric">
              {s.metric}
              <span className="flow-unit">{s.unit}</span>
            </span>
            <span className="t-body-strong">{s.title}</span>
            <p className="t-small">{s.body}</p>
            <span className="flow-keys t-mono">{s.keys}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
