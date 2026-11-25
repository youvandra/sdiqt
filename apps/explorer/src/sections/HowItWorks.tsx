import type { ApiHealthV1 } from "@sdiqt/protocol";
import { SectionHead } from "../components/Ui.tsx";
import { ago, type BatchRow, entryCount, num } from "../lib/format.ts";

interface Step {
  title: string;
  body: string;
  metric: string;
}

export function HowItWorks({
  rows,
  health,
}: {
  rows: BatchRow[];
  health: ApiHealthV1 | undefined;
}) {
  const entriesTotal = rows.reduce((n, r) => n + entryCount(r.inbox_from, r.inbox_end), 0);
  const matched = rows.filter((r) => r.judged === "match").length;
  const proven = rows.filter((r) => r.validity === "proven").length;
  const last = health?.last_receipt;

  const steps: Step[] = [
    {
      title: "Inbox",
      body: "Users post signed deposits and transfers to the rollup inbox on QoreChain. SDIQT archives every entry, so nothing depends on the chain keeping it.",
      metric: `${num(entriesTotal)} entries archived`,
    },
    {
      title: "Batch",
      body: "A submitter posts a batch: an inbox range plus the roots it claims. QoreChain opens a challenge window for it.",
      metric: `${num(rows.length)} batches seen`,
    },
    {
      title: "Re-execute",
      body: "The watchtower replays the range from its archive and compares every root. A wrong root gets a fraud challenge.",
      metric: `${num(matched)} of ${num(rows.length)} match`,
    },
    {
      title: "STARK + QSTR",
      body: "The prover runs the same state transition inside SP1 and posts a QSTR commitment naming the proof bundle.",
      metric: `${num(proven)} proven`,
    },
    {
      title: "Signed receipt",
      body: "The tower signs a receipt with ML-DSA-87 that holds both answers: settlement from the chain, validity from the proof.",
      metric: last ? `Last ${ago(last.issued_at)}` : "No receipt yet",
    },
  ];

  return (
    <section className="section how" id="how-it-works" aria-labelledby="how-title">
      <div className="how-bg" aria-hidden="true" />
      <SectionHead
        eyebrow="How It Works"
        title="From inbox entry to signed receipt."
        id="how-title"
      >
        Five steps, each one checkable on its own. The numbers come from the live watchtower.
      </SectionHead>
      <ol className="steps">
        {steps.map((s, i) => (
          <li key={s.title} className="step">
            <span className="t-body-strong">
              {String(i + 1).padStart(2, "0")} · {s.title}
            </span>
            <p className="t-body">{s.body}</p>
            <span className="step-metric t-mono">{s.metric}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
