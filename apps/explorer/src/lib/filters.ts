import type { BatchRow, Settlement, Validity } from "./format.ts";

export interface Filter {
  settlement: Settlement | "all";
  validity: Validity | "all";
  query: string;
}

export const NO_FILTER: Filter = { settlement: "all", validity: "all", query: "" };

/** Batch number ("6", "#6") or a submit tx prefix, case-insensitive. */
export function matches(r: BatchRow, f: Filter): boolean {
  if (f.settlement !== "all" && r.settlement !== f.settlement) return false;
  if (f.validity !== "all" && r.validity !== f.validity) return false;
  const q = f.query.trim().replace(/^#/, "").toLowerCase();
  if (!q) return true;
  return r.batch_index === q || r.submit_tx.toLowerCase().startsWith(q);
}
