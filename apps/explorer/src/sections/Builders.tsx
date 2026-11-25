import { ArrowUpRight } from "lucide-react";
import { SectionHead } from "../components/Ui.tsx";
import { BLOB, TREE } from "../lib/links.ts";

const LINKS = [
  {
    title: "QSTR v1 spec",
    body: "The commitment the prover posts on chain for every proven batch.",
    href: `${BLOB}/specs/qstr-v1.md`,
  },
  {
    title: "Verifier crate",
    body: "sdiqt-verify: the CLI, the library and the WebAssembly build used on this page.",
    href: `${TREE}/crates/sdiqt-verify`,
  },
  {
    title: "Test vectors",
    body: "Archived rollup data, a golden proof bundle and the real batch 1 bundle.",
    href: `${TREE}/vectors`,
  },
  {
    title: "Prover calibration",
    body: "Measured cycles, proof times and memory per chunk on the prover Mac.",
    href: `${BLOB}/docs/prover-calibration.md`,
  },
  {
    title: "Security policy",
    body: "How to report a vulnerability and what is in scope.",
    href: `${BLOB}/SECURITY.md`,
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
        Apache-2.0. Specs, code and test data live in one repository.
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
