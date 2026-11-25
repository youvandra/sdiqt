import type { ApiBatchDetailV1 } from "@sdiqt/protocol";
import { Check, FlipHorizontal2, Loader2, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "../components/Ui.tsx";
import { type Bundle, bundleName, fetchBundle, flipOneByte } from "../lib/bundle.ts";
import { num } from "../lib/format.ts";

type Submission = ApiBatchDetailV1["submissions"][number];
type Claim = NonNullable<Submission["claim"]>;

interface Verdict {
  valid: boolean;
  ms: number;
  error?: string;
}

type State =
  | { step: "idle" }
  | { step: "download"; loaded: number }
  | { step: "verify"; bundle: Bundle; downloadMs: number }
  | {
      step: "done";
      bundle: Bundle;
      downloadMs: number;
      verdict: Verdict;
      /** Manifest fields that differ from the chain roots shown above. */
      chainDiffs: string[];
    }
  | { step: "error"; message: string };

type Flip =
  | { step: "idle" }
  | { step: "running" }
  | { step: "done"; verdict: Verdict; offset: number };

const mb = (n: number) => `${(n / 1_048_576).toFixed(2)} MB`;
const ms = (n: number) => `${num(Math.round(n))} ms`;

/** Field names the manifest and the chain share, compared after a valid proof. */
function chainDiffs(bundle: Bundle, index: string, s: Submission): string[] {
  const m = bundle.manifest;
  const c = s.chain;
  const pairs: Array<[string, string, string | undefined]> = [
    ["batch_index", m.batch_index, index],
    ["inbox_from", m.inbox_from, s.inbox_from],
    ["inbox_end", m.inbox_end, s.inbox_end],
    ["parent_root", m.parent_root, c?.prev_state_root],
    ["state_root", m.state_root, c?.state_root],
    ["withdrawals_root", m.withdrawals_root, c?.withdrawals_root],
    ["data_hash", m.data_hash, c?.data_hash],
  ];
  return pairs.filter(([, a, b]) => b !== undefined && a !== b).map(([k]) => k);
}

/** Download the batch's STARK bundle and check it with the wasm verifier in this tab. */
export function BrowserVerify({ index, s, claim }: { index: string; s: Submission; claim: Claim }) {
  const [state, setState] = useState<State>({ step: "idle" });
  const [flip, setFlip] = useState<Flip>({ step: "idle" });
  const ctrl = useRef<AbortController | null>(null);
  const name = bundleName(index, s.submit_tx);

  useEffect(() => () => ctrl.current?.abort(), []);

  const run = async () => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setFlip({ step: "idle" });
    setState({ step: "download", loaded: 0 });
    try {
      const { verifyBundleInBrowser, loadVerifier } = await import("@sdiqt/verify/web");
      const t0 = performance.now();
      const [bundle] = await Promise.all([
        fetchBundle(name, (loaded) => setState({ step: "download", loaded }), c.signal),
        loadVerifier(),
      ]);
      const downloadMs = performance.now() - t0;
      setState({ step: "verify", bundle, downloadMs });
      // Let the "Verifying" state paint before the verifier holds the thread.
      await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
      const verdict = await verifyBundleInBrowser(
        bundle.manifestJson,
        bundle.proofs,
        claim.program_vkey_hash,
      );
      if (c.signal.aborted) return;
      setState({
        step: "done",
        bundle,
        downloadMs,
        verdict,
        chainDiffs: chainDiffs(bundle, index, s),
      });
    } catch (err) {
      if (c.signal.aborted) return;
      setState({ step: "error", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const runFlip = async () => {
    if (state.step !== "done") return;
    setFlip({ step: "running" });
    await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
    const { verifyBundleInBrowser } = await import("@sdiqt/verify/web");
    const flipped = await flipOneByte(state.bundle);
    const verdict = await verifyBundleInBrowser(
      flipped.manifestJson,
      flipped.proofs,
      claim.program_vkey_hash,
    );
    setFlip({ step: "done", verdict, offset: flipped.offset });
  };

  const busy = state.step === "download" || state.step === "verify";
  const ok = state.step === "done" && state.verdict.valid && state.chainDiffs.length === 0;

  return (
    <section className="card card-pad panel verify-panel" aria-live="polite">
      <div className="card-head">
        <span className="card-title">
          <ShieldCheck size={16} aria-hidden="true" /> Verify in your browser
        </span>
        {state.step === "done" && (
          <Badge tone={ok ? "ok" : "bad"}>{ok ? "Valid" : "Invalid"}</Badge>
        )}
      </div>
      <p className="t-small">
        Downloads bundle <span className="t-mono">{name}</span> ({claim.chunks.length} STARK{" "}
        {claim.chunks.length === 1 ? "proof" : "proofs"}) and checks it here with the SP1 verifier
        compiled to WebAssembly, so the proof answer comes from your own browser.
      </p>

      <ol className="vsteps">
        <VStep
          status={
            state.step === "download"
              ? "run"
              : state.step === "idle" || state.step === "error"
                ? "wait"
                : "ok"
          }
          label="Download bundle"
          detail={
            state.step === "download"
              ? mb(state.loaded)
              : state.step === "verify" || state.step === "done"
                ? `${mb(state.bundle.bytes)} in ${ms(state.downloadMs)}`
                : undefined
          }
        />
        <VStep
          status={
            state.step === "verify"
              ? "run"
              : state.step === "done"
                ? state.verdict.valid
                  ? "ok"
                  : "bad"
                : "wait"
          }
          label="Verify every chunk, the links and the proof root"
          detail={
            state.step === "done"
              ? state.verdict.valid
                ? ms(state.verdict.ms)
                : state.verdict.error
              : undefined
          }
        />
        <VStep
          status={
            state.step === "done" && state.verdict.valid
              ? state.chainDiffs.length === 0
                ? "ok"
                : "bad"
              : "wait"
          }
          label="Match the proven roots with the chain roots"
          detail={
            state.step === "done" && state.verdict.valid
              ? state.chainDiffs.length === 0
                ? "All 7 fields equal"
                : `Differs: ${state.chainDiffs.join(", ")}`
              : undefined
          }
        />
      </ol>

      {state.step === "error" && (
        <div className="notice" data-tone="bad" role="alert">
          {state.message}
        </div>
      )}

      <div className="verify-actions">
        <button type="button" className="btn btn-sm btn-primary" onClick={run} disabled={busy}>
          {busy ? (
            <Loader2 size={14} className="spin" aria-hidden="true" />
          ) : (
            <ShieldCheck size={14} aria-hidden="true" />
          )}
          {state.step === "done" || state.step === "error" ? "Verify Again" : "Verify Proof"}
        </button>
        {state.step === "done" && state.verdict.valid && (
          <button
            type="button"
            className="btn btn-sm btn-secondary"
            onClick={runFlip}
            disabled={flip.step === "running"}
          >
            <FlipHorizontal2 size={14} aria-hidden="true" /> Flip One Byte
          </button>
        )}
      </div>

      {flip.step !== "idle" && (
        <div
          className="flip-result"
          data-tone={flip.step === "done" && !flip.verdict.valid ? "ok" : "wait"}
        >
          {flip.step === "running" ? (
            <span className="t-small">Verifying the tampered copy</span>
          ) : (
            <>
              <span className="t-body-strong">
                {flip.verdict.valid
                  ? "The tampered copy passed. Report this as a bug."
                  : `Tampered copy rejected in ${ms(flip.verdict.ms)}`}
              </span>
              <span className="t-small">
                Bit 0 of byte {num(flip.offset)} in chunk 0 flipped, chunk hash recomputed so only
                the STARK check can catch it. Verifier:{" "}
                <span className="t-mono flip-error">{flip.verdict.error ?? "accepted"}</span>
              </span>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function VStep({
  status,
  label,
  detail,
}: {
  status: "wait" | "run" | "ok" | "bad";
  label: string;
  detail?: string | undefined;
}) {
  return (
    <li className="vstep" data-status={status}>
      <span className="vstep-icon" aria-hidden="true">
        {status === "run" ? (
          <Loader2 size={14} className="spin" />
        ) : status === "ok" ? (
          <Check size={14} />
        ) : status === "bad" ? (
          <X size={14} />
        ) : null}
      </span>
      <span className="vstep-text">
        <span className="t-small-strong">{label}</span>
        {detail && <span className="t-caption vstep-detail">{detail}</span>}
      </span>
    </li>
  );
}
