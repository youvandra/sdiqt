import type { ApiBatchListV1 } from "@sdiqt/protocol";

export type BatchRow = ApiBatchListV1["batches"][number];
export type Settlement = BatchRow["settlement"];
export type Validity = BatchRow["validity"];
export type Tone = "ok" | "bad" | "wait" | "accent";

/** `28763ad8…620e2d`: head and tail of a long hash. */
export function shortHash(h: string, head = 8, tail = 6): string {
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export const SETTLEMENT: Record<Settlement, { label: string; tone: Tone; hint: string }> = {
  pending: { label: "Pending", tone: "wait", hint: "Inside its challenge window on QoreChain" },
  final: { label: "Final", tone: "ok", hint: "Challenge window closed, QoreChain finalized it" },
  rejected: { label: "Rejected", tone: "bad", hint: "Rejected by an upheld fraud proof" },
  unknown: {
    label: "Unknown",
    tone: "wait",
    hint: "The chain record is gone and no anchor proves it",
  },
};

export const VALIDITY: Record<Validity, { label: string; tone: Tone; hint: string }> = {
  proving: {
    label: "Proving",
    tone: "wait",
    hint: "Inside the proof deadline, no proof posted yet",
  },
  proven: {
    label: "Proven",
    tone: "ok",
    hint: "A STARK bundle verified and matches the chain roots",
  },
  mismatch: {
    label: "Mismatch",
    tone: "bad",
    hint: "Re-execution gives different roots than the chain",
  },
  unproven: {
    label: "Unproven",
    tone: "accent",
    hint: "The proof deadline passed without a proof",
  },
};

export const SETTLEMENT_ORDER: Settlement[] = ["pending", "final", "rejected", "unknown"];
export const VALIDITY_ORDER: Validity[] = ["proving", "proven", "mismatch", "unproven"];

/**
 * The second axis of a batch. With proofs it is the STARK validity; for a
 * rollup SDIQT only re-executes it is the re-execution verdict, which a
 * watch-only tower stores as `unproven` (match) or `mismatch`.
 */
const REEXEC: Partial<Record<Validity, { label: string; tone: Tone; hint: string }>> = {
  unproven: {
    label: "Match",
    tone: "ok",
    hint: "Re-execution from chain data gives the chain's roots",
  },
  mismatch: VALIDITY.mismatch,
};

export function axis(tier: "stark" | "reexec") {
  const order: Validity[] = tier === "stark" ? VALIDITY_ORDER : ["unproven", "mismatch"];
  return {
    name: tier === "stark" ? "Proof" : "Re-execution",
    order,
    of: (v: Validity) => (tier === "stark" ? VALIDITY[v] : (REEXEC[v] ?? VALIDITY[v])),
  };
}

const nf = new Intl.NumberFormat("en-US");
/** 10700123 -> "10,700,123"; accepts decimal strings. */
export const num = (v: string | number | bigint) =>
  nf.format(typeof v === "string" ? BigInt(v) : v);

/** Number of inbox entries in a range with an exclusive end. */
export const entryCount = (from: string, end: string) => Number(BigInt(end) - BigInt(from));

/** "5 entries" / "1 entry". */
export function entries(from: string, end: string): string {
  const n = entryCount(from, end);
  return `${nf.format(n)} ${n === 1 ? "entry" : "entries"}`;
}

/** "12 s ago", "4 min ago", "3 h ago", "2 d ago". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86_400)} d ago`;
}

/** 3725 -> "1 h 2 min", 95 -> "1 min 35 s". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h} h ${m} min`;
  if (m > 0) return `${m} min ${r} s`;
  return `${r} s`;
}

/** Reader labels for root and manifest fields, keyed by API and manifest names. */
const FIELD_LABELS: Record<string, string> = {
  batch_index: "Batch index",
  inbox_from: "Inbox start",
  inbox_end: "Inbox end",
  parentRoot: "Previous state root",
  parent_root: "Previous state root",
  stateRoot: "State root",
  state_root: "State root",
  withdrawalsRoot: "Withdrawals root",
  withdrawals_root: "Withdrawals root",
  dataHash: "Data hash",
  data_hash: "Data hash",
};

/** "State root" for `stateRoot` or `state_root`; an unknown name passes through. */
export function fieldLabel(name: string): string {
  return FIELD_LABELS[name] ?? name;
}

/** "25 Nov 2026, 06:40 UTC". */
export function absolute(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  })} UTC`;
}
