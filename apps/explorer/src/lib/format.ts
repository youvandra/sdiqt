import type { ApiBatchListV1 } from "@sdiqt/protocol";

type Row = ApiBatchListV1["batches"][number];
export type Tone = "ok" | "bad" | "wait" | "accent";

/** `28763ad8…62c59c`: first 8 and last 6 characters. */
export function shortHash(h: string, head = 8, tail = 6): string {
  return h.length <= head + tail + 1 ? h : `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export const SETTLEMENT: Record<Row["settlement"], { label: string; tone: Tone }> = {
  pending: { label: "Pending", tone: "wait" },
  final: { label: "Final", tone: "ok" },
  rejected: { label: "Void", tone: "bad" },
  unknown: { label: "Unknown", tone: "wait" },
};

export const VALIDITY: Record<Row["validity"], { label: string; tone: Tone }> = {
  proving: { label: "Proving", tone: "wait" },
  proven: { label: "Proven", tone: "ok" },
  mismatch: { label: "Mismatch", tone: "bad" },
  unproven: { label: "Unproven", tone: "accent" },
};

/** "12 s ago", "4 min ago", "3 h ago". */
export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86_400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86_400)} d ago`;
}

/** "5 entries" / "1 entry" for an inbox range. */
export function entries(from: string, end: string): string {
  const n = Number(BigInt(end) - BigInt(from));
  return `${n} ${n === 1 ? "entry" : "entries"}`;
}
