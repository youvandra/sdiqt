import { ArrowUpRight } from "lucide-react";
import { SectionHead } from "../components/Ui.tsx";
import { BLOB, TREE } from "../lib/links.ts";

const LINKS = [
  {
    title: "Evidence",
    body: "Every claim with its diana transaction, regenerated from chain.",
    href: `${BLOB}/PROOF.md`,
  },
  {
    title: "Threat Model",
    body: "12 threats, each with its control.",
    href: `${BLOB}/THREAT_MODEL.md`,
  },
  {
    title: "QSTR v1 Spec",
    body: "The commitment the prover posts on chain for every proven batch.",
    href: `${BLOB}/specs/qstr-v1.md`,
  },
  {
    title: "Verifier Crate",
    body: "sdiqt-verify: the CLI, the library and the WebAssembly build used on this page.",
    href: `${TREE}/crates/sdiqt-verify`,
  },
  {
    title: "Test Vectors",
    body: "Archived rollup data, a golden proof bundle and the real batch 1 bundle.",
    href: `${TREE}/vectors`,
  },
  {
    title: "Watchtower API",
    body: "Response schemas shared by the watchtower and this explorer.",
    href: `${BLOB}/packages/protocol/src/api.ts`,
  },
];

export function Builders() {
  return (
    <section className="section" id="builders" aria-labelledby="builders-title">
      <SectionHead eyebrow="For Builders" title="Everything is open source." id="builders-title">
        Apache-2.0. Specs, code, test data and evidence live in one repository.
      </SectionHead>
      <div className="builders-grid">
        {LINKS.map((l) => (
          <a
            key={l.title}
            className="card card-pad builder"
            href={l.href}
            target="_blank"
            rel="noreferrer"
          >
            <span className="builder-head">
              <span className="t-body-strong">{l.title}</span>
              <ArrowUpRight size={16} aria-hidden="true" />
            </span>
            <span className="t-small">{l.body}</span>
          </a>
        ))}
      </div>
    </section>
  );
}
