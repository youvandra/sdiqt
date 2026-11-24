import { FileCheck2, Landmark, ShieldCheck } from "lucide-react";
import "./security.css";

const POINTS = [
  {
    icon: Landmark,
    title: "Settlement comes from QoreChain",
    body: "A batch becomes final when its challenge window closes. A wrong root is challenged with a qledger fraud proof and rolled back.",
  },
  {
    icon: FileCheck2,
    title: "Validity comes from a STARK",
    body: "An SP1 compressed STARK proves the batch was executed correctly. The tower and your browser check it off chain.",
  },
  {
    icon: ShieldCheck,
    title: "Receipts are signed with ML-DSA-87",
    body: "Every change of state on either axis gets a new receipt, signed by the tower's registered post-quantum key.",
  },
];

export function Security() {
  return (
    <section className="security">
      <div className="security-bg" aria-hidden="true" />
      <div className="section">
        <div className="section-title">
          <span className="eyebrow">Security</span>
          <h1 className="t-h2">What each check covers.</h1>
          <p className="t-body">Two independent axes, both readable by anyone.</p>
        </div>
        <div className="security-points">
          {POINTS.map((p) => (
            <div key={p.title} className="security-point">
              <p className="t-body-strong">
                <p.icon size={16} aria-hidden="true" />
                {p.title}
              </p>
              <p className="t-body">{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
