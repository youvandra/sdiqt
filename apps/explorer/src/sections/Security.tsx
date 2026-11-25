import { FileCheck2, KeyRound, ShieldCheck } from "lucide-react";
import { SectionHead } from "../components/Ui.tsx";
import { SPECS_URL } from "../lib/links.ts";

const POINTS = [
  {
    icon: ShieldCheck,
    title: "Hash-based proofs",
    body: "Each sdiqt-1 batch is proven with a STARK. Its security rests on hash functions, which hold up against the quantum attacks that break elliptic curves.",
  },
  {
    icon: KeyRound,
    title: "Post-quantum signatures",
    body: "Receipts are signed with ML-DSA-87 (FIPS 204). Rollup entries carry ML-DSA-44 signatures, checked inside the proof in full mode.",
  },
  {
    icon: FileCheck2,
    title: "Checkable after pruning",
    body: "QoreChain prunes batch records after about seven days. A receipt plus its proof bundle still verifies, offline, with only the published program key.",
  },
];

const LIMITS = [
  "The watchtower and your browser verify the STARK off chain. QoreChain settles by its own fraud-proof rules.",
  "Chain data shown here is relayed by sdiqt.xyz. The receipts are signed, so you can check them without trusting the relay.",
  "One prover runs on a single Mac during the testnet event. A slow prover shows up as Unproven, never as a false Proven.",
  "On other teams' qledger rollups the watchtower re-executes, signs receipts and reports wrong roots. STARK proofs and fraud challenges run on sdiqt-1.",
];

export function Security() {
  return (
    <section className="section security" id="security" aria-labelledby="security-title">
      <div className="security-bg" aria-hidden="true" />
      <SectionHead eyebrow="Security" title="Built for the day after Q-Day." id="security-title">
        What the proofs and signatures guarantee, and where the guarantee stops.
      </SectionHead>
      <div className="security-grid">
        {POINTS.map((p) => (
          <article key={p.title} className="card card-pad point">
            <span className="card-title">
              <p.icon size={16} aria-hidden="true" /> {p.title}
            </span>
            <p className="t-body">{p.body}</p>
          </article>
        ))}
      </div>
      <div className="card card-pad limits">
        <div className="card-head">
          <span className="card-title">Known limits</span>
          <a className="t-small limits-link" href={SPECS_URL} target="_blank" rel="noreferrer">
            Read the specs
          </a>
        </div>
        <ul>
          {LIMITS.map((l) => (
            <li key={l} className="t-body">
              {l}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
