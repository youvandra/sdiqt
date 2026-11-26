import type { ApiBatchDetailV1, ApiReceiptV1 } from "@sdiqt/protocol";
import { Archive, Check, Download, Minus, X } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge, Hash, Segmented } from "../components/Ui.tsx";
import { usePolled } from "../lib/api.ts";
import { bundleName } from "../lib/bundle.ts";
import { SITE, trapTab, useDocumentTitle } from "../lib/dom.ts";
import { absolute, ago, axis, entries, fieldLabel, num, SETTLEMENT } from "../lib/format.ts";
import { SITE_URL } from "../lib/links.ts";
import { useRollup } from "../lib/rollup.ts";
import { BrowserVerify } from "./BrowserVerify.tsx";

type Submission = ApiBatchDetailV1["submissions"][number];
type Tab = "overview" | "proof" | "receipt" | "history";

/** Right-side drawer with everything the tower knows about one batch index. */
export function BatchDrawer({
  index,
  onClose,
  verify = false,
}: {
  index: string;
  onClose: () => void;
  /** Open on the Proof tab and start the browser check at once. */
  verify?: boolean;
}) {
  const { id, tier, api } = useRollup();
  const stark = tier === "stark";
  const ax = axis(tier);
  const detail = usePolled((s) => api.batch(index, s), `batch:${id}:${index}`);
  const [tab, setTab] = useState<Tab>(verify && stark ? "proof" : "overview");
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  useDocumentTitle(`Batch ${index} · ${id} · ${SITE}`, true);

  // Modal: focus moves in, Tab stays in, Esc closes, and focus goes back to
  // the row (or ribbon cell) that opened the drawer.
  useEffect(() => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCloseRef.current();
      else if (dialogRef.current) trapTab(dialogRef.current, e);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
      if (opener && opener !== document.body && opener.isConnected)
        opener.focus({ preventScroll: true });
    };
  }, []);

  const subs = detail.data?.submissions;
  const current = subs?.[subs.length - 1];

  return (
    <div className="drawer-root">
      <button
        type="button"
        className="drawer-backdrop"
        aria-label="Close batch"
        onClick={onClose}
        tabIndex={-1}
      />
      <aside
        ref={dialogRef}
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
      >
        <header className="drawer-head">
          <div className="drawer-title-row">
            <span className="eyebrow">{id}</span>
            <button
              ref={closeRef}
              type="button"
              className="icon-btn"
              aria-label="Close batch"
              onClick={onClose}
            >
              <X size={20} />
            </button>
          </div>
          <h2 className="t-h2" id="drawer-title">
            Batch {index}
          </h2>
          {current && (
            <div className="drawer-badges">
              <Badge
                tone={SETTLEMENT[current.settlement].tone}
                title={SETTLEMENT[current.settlement].hint}
              >
                {SETTLEMENT[current.settlement].label}
              </Badge>
              <Badge tone={ax.of(current.validity).tone} title={ax.of(current.validity).hint}>
                {stark
                  ? ax.of(current.validity).label
                  : `Re-executed: ${ax.of(current.validity).label}`}
              </Badge>
              {current.pruned && (
                <Badge tone="accent" title="QoreChain pruned this batch record">
                  From Archive
                </Badge>
              )}
              <span className="t-small">
                {entries(current.inbox_from, current.inbox_end)} · height{" "}
                {num(current.submit_height)}
              </span>
            </div>
          )}
          <Segmented
            label="Batch view"
            value={tab}
            onChange={setTab}
            options={[
              { value: "overview", label: "Overview" },
              ...(stark ? [{ value: "proof" as const, label: "Proof" }] : []),
              { value: "receipt", label: "Receipt" },
              { value: "history", label: "History", ...(subs ? { count: subs.length } : {}) },
            ]}
          />
        </header>

        <div className="drawer-body">
          {detail.error && !current && (
            <div className="notice" data-tone="bad" role="alert">
              Batch {index} cannot be read right now.
            </div>
          )}
          {!current && !detail.error && <p className="t-body">Reading batch {index}</p>}
          {current && tab === "overview" && <OverviewTab s={current} stark={stark} />}
          {current && stark && tab === "proof" && (
            <ProofTab index={index} s={current} autoVerify={verify} />
          )}
          {current && tab === "receipt" && <ReceiptTab index={index} s={current} />}
          {subs && tab === "history" && <HistoryTab subs={subs} />}
        </div>
      </aside>
    </div>
  );
}

const ROOT_ROWS = [
  { key: "parentRoot", label: "Previous state", chain: "prev_state_root", claim: "parent_root" },
  { key: "stateRoot", label: "State", chain: "state_root", claim: "state_root" },
  {
    key: "withdrawalsRoot",
    label: "Withdrawals",
    chain: "withdrawals_root",
    claim: "withdrawals_root",
  },
  { key: "dataHash", label: "Data hash", chain: "data_hash", claim: "data_hash" },
] as const;

function Panel({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card card-pad panel">
      <div className="card-head">
        <span className="card-title">{title}</span>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Mark({ ok, label }: { ok: boolean | undefined; label: string }) {
  if (ok === undefined)
    return <Minus size={16} className="c-muted" aria-label={`${label}: no data`} />;
  return ok ? (
    <Check size={16} className="c-ok" aria-label={`${label}: matches`} />
  ) : (
    <X size={16} className="c-bad" aria-label={`${label}: differs`} />
  );
}

function OverviewTab({ s, stark }: { s: Submission; stark: boolean }) {
  const honest = s.challenge?.honest_state_root;
  return (
    <>
      {!stark && (
        <div className="notice" data-tone="accent" role="note">
          <span>
            This rollup gets re-execution and a signed receipt. STARK proofs run on sdiqt-1.
          </span>
        </div>
      )}
      {s.pruned && (
        <div className="notice" data-tone="accent" role="note">
          <Archive size={16} aria-hidden="true" />
          <span>
            QoreChain pruned this batch record after its retention window. The roots, proof claim
            and receipts below are read from the SDIQT archive, and the settlement comes from the
            state root the rollup creator anchored.
          </span>
        </div>
      )}
      <Panel
        title="Roots"
        aside={
          <span className="t-caption">
            {s.judged === "match"
              ? "Re-execution matches the chain"
              : `${num(s.differs.length)} ${s.differs.length === 1 ? "field differs" : "fields differ"}`}
          </span>
        }
      >
        {s.chain === null ? (
          <p className="t-small">The tower stored this submission before it kept chain roots.</p>
        ) : (
          <div className="roots" data-tier={stark ? "stark" : "reexec"}>
            <div className="roots-head t-caption">
              <span>Field</span>
              <span>Chain</span>
              <span className="c-center">Re-execution</span>
              {stark && <span className="c-center">Proof claim</span>}
            </div>
            {ROOT_ROWS.map((r) => {
              const chainValue = s.chain?.[r.chain] ?? "";
              const claimValue = s.claim?.[r.claim];
              const differs = s.differs.includes(r.key);
              return (
                <div key={r.key} className="roots-row" data-differs={differs}>
                  <span className="t-small">{r.label}</span>
                  <span>
                    {chainValue === "" ? (
                      <span className="t-small c-muted">Empty</span>
                    ) : (
                      <Hash value={chainValue} head={6} tail={4} />
                    )}
                    {differs && r.key === "stateRoot" && honest && (
                      <span className="roots-honest t-caption">
                        Correct root <Hash value={honest} head={6} tail={4} />
                      </span>
                    )}
                  </span>
                  <span className="c-center">
                    <Mark ok={!differs} label="Re-execution" />
                  </span>
                  {stark && (
                    <span className="c-center">
                      <Mark
                        ok={claimValue === undefined ? undefined : claimValue === chainValue}
                        label="Proof claim"
                      />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel title="Settlement">
        <dl className="kv">
          <dt>Status</dt>
          <dd>
            {SETTLEMENT[s.settlement].label}
            <span className="kv-hint">{SETTLEMENT[s.settlement].hint}</span>
          </dd>
          <dt>Submit tx</dt>
          <dd>
            <Hash value={s.submit_tx} />
          </dd>
          <dt>Submitter</dt>
          <dd>
            <Hash value={s.submitter} head={10} tail={6} />
          </dd>
          <dt>Submitted</dt>
          <dd>
            {s.submitted_time
              ? `${absolute(s.submitted_time)} (${ago(s.submitted_time)})`
              : "Unknown"}
          </dd>
          <dt>Inbox</dt>
          <dd>
            {num(s.inbox_from)} to {num(s.inbox_end)} ({entries(s.inbox_from, s.inbox_end)})
          </dd>
          <dt>Chain record</dt>
          <dd>{s.pruned ? "Pruned by QoreChain; settled from the anchor" : "Still on chain"}</dd>
          {s.note && (
            <>
              <dt>Note</dt>
              <dd>{s.note}</dd>
            </>
          )}
        </dl>
      </Panel>
    </>
  );
}

function ProofTab({ index, s, autoVerify }: { index: string; s: Submission; autoVerify: boolean }) {
  const c = s.claim;
  if (!c) {
    return (
      <div className="empty-panel">
        <p className="t-body-strong">No proof claim yet.</p>
        <p className="t-small">
          {s.validity === "unproven"
            ? "The proof deadline passed without a QSTR post for this batch. The settlement answer still stands on its own."
            : s.validity === "mismatch"
              ? "Re-execution disagrees with the chain, so no honest proof can match these roots."
              : "The prover posts a QSTR commitment and a STARK bundle before the proof deadline. This view fills in once the tower verifies it."}
        </p>
      </div>
    );
  }
  return (
    <>
      <Panel
        title="Proof claim"
        aside={
          <Badge tone={c.verified ? "ok" : "bad"}>
            {c.verified ? `Verified in ${num(c.verify_ms)} ms` : "Failed"}
          </Badge>
        }
      >
        <dl className="kv">
          <dt>Signature mode</dt>
          <dd>
            {c.sig_mode === "full"
              ? "Full, ML-DSA-44 checked inside the proof"
              : "v0, signatures checked outside the proof"}
          </dd>
          <dt>Program key</dt>
          <dd>
            <Hash value={c.program_vkey_hash} />
          </dd>
          <dt>Proof root</dt>
          <dd>
            <Hash value={c.proof_root} />
          </dd>
          <dt>QSTR tx</dt>
          <dd>{s.qstr_tx ? <Hash value={s.qstr_tx} /> : "Not posted"}</dd>
        </dl>
      </Panel>
      <BrowserVerify index={index} s={s} claim={c} autoRun={autoVerify} />
      <Panel
        title="Chunks"
        aside={
          <span className="t-caption">
            {num(c.chunks.length)} STARK {c.chunks.length === 1 ? "proof" : "proofs"}
          </span>
        }
      >
        <ol className="chunks">
          {c.chunks.map((ch) => (
            <li key={ch.index}>
              <span className="t-mono chunk-index">{ch.index.padStart(2, "0")}</span>
              <Hash value={ch.proof_sha256} head={10} tail={8} />
            </li>
          ))}
        </ol>
        <p className="t-caption chunks-note">
          The proof root is the hash of these chunk hashes in order; the QSTR post commits to it.
        </p>
      </Panel>
      <Panel title="Verify it yourself">
        <p className="t-small">
          Download bundle <span className="t-mono">{bundleName(index, s.submit_tx)}</span> and run
          the open-source verifier. It works offline and gives the same answer after QoreChain
          prunes the batch.
        </p>
        <pre className="cmd">{verifyCommands(bundleName(index, s.submit_tx), c)}</pre>
      </Panel>
    </>
  );
}

/** Shell lines that fetch a bundle from sdiqt.xyz and verify it with the program pinned. */
function verifyCommands(
  name: string,
  c: { chunks: { index: string }[]; program_vkey_hash: string },
) {
  const base = `${SITE_URL}/bundles/${name}`;
  const files = ["manifest.json", ...c.chunks.map((ch) => `chunk-${ch.index}.bin`)];
  return [
    `mkdir -p ${name}`,
    ...files.map((f) => `curl -sf --output-dir ${name} -O ${base}/${f}`),
    `sdiqt-verify bundle ${name} \\`,
    `  --vkey-hash ${c.program_vkey_hash}`,
  ].join("\n");
}

function ReceiptTab({ index, s }: { index: string; s: Submission }) {
  const { id, tier, api } = useRollup();
  const ax = axis(tier);
  const receipt = usePolled((sig) => api.receipt(index, sig), `receipt:${id}:${index}`, 30_000);
  return (
    <>
      <Panel
        title="Receipt timeline"
        aside={<span className="t-caption">{s.timeline.length} signed</span>}
      >
        {s.timeline.length === 0 ? (
          <p className="t-small">No receipt issued for this submission yet.</p>
        ) : (
          <ol className="timeline">
            {s.timeline.map((t) => (
              <li key={t.issued_at}>
                <span className="t-body-strong">
                  {SETTLEMENT[t.settlement].label} · {ax.of(t.validity).label}
                </span>
                <span className="t-small">{absolute(t.issued_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
      <Panel
        title="Signed receipt"
        aside={receipt.data && <ReceiptActions index={index} receipt={receipt.data} />}
      >
        {receipt.data ? (
          <>
            <dl className="kv kv-tight">
              <dt>Issuer</dt>
              <dd>
                <Hash value={receipt.data.body.issuer} head={10} tail={6} />
              </dd>
              <dt>Deadline</dt>
              <dd>{absolute(receipt.data.body.challenge_deadline)}</dd>
              <dt>Signature</dt>
              <dd>ML-DSA-87, {num(receipt.data.signature.length / 2)} bytes</dd>
            </dl>
            <pre className="json">{JSON.stringify(receipt.data, null, 2)}</pre>
          </>
        ) : (
          <p className="t-small">
            {receipt.error ? `Receipt unavailable: ${receipt.error}` : "Reading receipt"}
          </p>
        )}
      </Panel>
    </>
  );
}

function ReceiptActions({ index, receipt }: { index: string; receipt: ApiReceiptV1 }) {
  const [copied, setCopied] = useState(false);
  const text = JSON.stringify(receipt);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard blocked; Download still works.
    }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `sdiqt-receipt-${receipt.body.rollup_id}-${index}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <span className="panel-actions">
      <button type="button" className="btn btn-sm btn-secondary" onClick={copy}>
        {copied ? "Copied" : "Copy"}
      </button>
      <button type="button" className="btn btn-sm btn-secondary" onClick={download}>
        <Download size={14} aria-hidden="true" /> Download
      </button>
    </span>
  );
}

const CHALLENGE_LABEL: Record<NonNullable<Submission["challenge"]>["status"], string> = {
  watch: "Watch only",
  refused: "Skipped",
  failed: "Challenge failed",
  sent: "Challenge sent",
  upheld: "Challenge upheld",
  dismissed: "Challenge dismissed",
};

function HistoryTab({ subs }: { subs: Submission[] }) {
  return (
    <ol className="history">
      {[...subs].reverse().map((s, i) => (
        <li key={s.submit_tx} className="card card-pad" data-current={i === 0}>
          <div className="card-head">
            <span className="card-title">
              {i === 0 ? "Current submission" : `Submission ${subs.length - i}`}
            </span>
            <Badge tone={SETTLEMENT[s.settlement].tone}>{SETTLEMENT[s.settlement].label}</Badge>
          </div>
          <dl className="kv kv-tight">
            <dt>Submit tx</dt>
            <dd>
              <Hash value={s.submit_tx} />
            </dd>
            <dt>Height</dt>
            <dd>{num(s.submit_height)}</dd>
            <dt>Re-execution</dt>
            <dd>
              {s.judged === "match"
                ? "Matches the chain"
                : `Differs: ${s.differs.map(fieldLabel).join(", ")}`}
            </dd>
            {s.challenge && (
              <>
                <dt>Challenge</dt>
                <dd>
                  {CHALLENGE_LABEL[s.challenge.status]}
                  {s.challenge.reason && <span className="kv-hint">{s.challenge.reason}</span>}
                </dd>
                {s.challenge.challenge_tx && (
                  <>
                    <dt>Challenge tx</dt>
                    <dd>
                      <Hash value={s.challenge.challenge_tx} />
                    </dd>
                  </>
                )}
                {s.challenge.resubmitted_tx && (
                  <>
                    <dt>Resubmitted</dt>
                    <dd>
                      <Hash value={s.challenge.resubmitted_tx} />
                    </dd>
                  </>
                )}
              </>
            )}
          </dl>
        </li>
      ))}
    </ol>
  );
}
