import { ChevronRight, FileCheck2, KeyRound, ShieldCheck } from "lucide-react";
import { SectionHead } from "../components/Ui.tsx";
import { SPECS_URL } from "../lib/links.ts";

const POINTS = [
  {
    icon: ShieldCheck,
    title: "Hash-Based Proofs",
    body: "Each sdiqt-1 batch is proven with a STARK built only from hashes, with SP1's 100-bit design target. The pairing-based SNARKs already on QoreChain fall to a large quantum computer.",
  },
  {
    icon: KeyRound,
    title: "Post-Quantum Keys",
    body: "Receipts are signed with ML-DSA-87 and rollup entries with ML-DSA-44, checked inside the proof. Sealed exits go to the watchtower's ML-KEM-1024 key.",
  },
  {
    icon: FileCheck2,
    title: "Checkable After Pruning",
    body: "QoreChain drops finalized batch records after 432,000 blocks. A receipt and its bundle still verify offline with only the published program key.",
  },
];

const LIMITS = [
  "The STARK is checked off chain, by the watchtower and your browser. Settlement on QoreChain stays optimistic.",
  "sdiqt.xyz relays chain data. Receipts are signed, so you can check them without trusting the relay.",
  "One prover runs on a single Mac during the testnet. A slow proof shows as Unproven until it lands.",
  "An independent challenger rejected staged batch 12. Our watchtower runs with challenges on, and its own on-chain challenge comes next.",
];

export function Security() {
  return (
    <section className="section security" id="security" aria-labelledby="security-title">
      <SectionHead eyebrow="Security" title="Post-quantum at every key." id="security-title">
        Which primitive guards each step, and where the guarantee ends.
      </SectionHead>
      <div className="security-grid">
        {POINTS.map((p) => (
          <article key={p.title} className="card card-pad point">
            <span className="point-icon" aria-hidden="true">
              <p.icon size={18} />
            </span>
            <span className="t-body-strong">{p.title}</span>
            <p className="t-small">{p.body}</p>
          </article>
        ))}
      </div>
      <details className="limits">
        <summary>
          <span className="t-body-strong">Known Limits</span>
          <span className="t-small">{LIMITS.length} items</span>
          <ChevronRight size={18} aria-hidden="true" className="limits-chev" />
        </summary>
        <ul>
          {LIMITS.map((l) => (
            <li key={l} className="t-small">
              {l}
            </li>
          ))}
        </ul>
        <a className="t-small limits-link" href={SPECS_URL} target="_blank" rel="noreferrer">
          Read the Specs
        </a>
      </details>
    </section>
  );
}
