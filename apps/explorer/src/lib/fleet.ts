/**
 * Batch history of every watched rollup, for the activity chart and the
 * per-rollup sparklines. One batch list per rollup with batches; the lists are
 * the same ones the rollup pages read.
 */
import type { ApiRollupListV1 } from "@sdiqt/protocol";
import { rollupApi, usePolled } from "./api.ts";
import type { BatchRow } from "./format.ts";

export interface FleetDay {
  /** UTC midnight, ms. */
  day: number;
  /** Batches submitted that day on the reference rollup and on every other one. */
  reference: number;
  others: number;
}

export interface Fleet {
  /** Rollup id to its batches, oldest first. */
  byRollup: Map<string, BatchRow[]>;
}

const DAY = 86_400_000;
export const dayOf = (iso: string) => Math.floor(Date.parse(iso) / DAY) * DAY;

/** Loads every non-empty rollup's batch list; refreshes every 2 min. */
export function useFleet(list: ApiRollupListV1 | undefined) {
  const ids = (list?.rollups ?? []).filter((r) => Number(r.batches) > 0).map((r) => r.rollup_id);
  return usePolled<Fleet>(
    async (signal) => {
      const lists = await Promise.all(ids.map((id) => rollupApi(id).batches(signal)));
      return { byRollup: new Map(ids.map((id, i) => [id, lists[i]?.batches ?? []])) };
    },
    `fleet:${ids.join(",")}`,
    120_000,
  );
}

/** Batches per UTC day across the fleet, every day from the first batch to today. */
export function fleetDays(fleet: Fleet, reference: string, now = Date.now()): FleetDay[] {
  const days = new Map<number, FleetDay>();
  let first = Number.POSITIVE_INFINITY;
  for (const [id, rows] of fleet.byRollup) {
    for (const r of rows) {
      if (!r.submitted_time) continue;
      const d = dayOf(r.submitted_time);
      first = Math.min(first, d);
      const slot = days.get(d) ?? { day: d, reference: 0, others: 0 };
      if (id === reference) slot.reference += 1;
      else slot.others += 1;
      days.set(d, slot);
    }
  }
  if (!Number.isFinite(first)) return [];
  const out: FleetDay[] = [];
  for (let d = first; d <= dayOf(new Date(now).toISOString()); d += DAY)
    out.push(days.get(d) ?? { day: d, reference: 0, others: 0 });
  return out;
}

/** Batches per day for one rollup over the last `n` days, oldest first. */
export function dailyCounts(rows: BatchRow[], n = 14, now = Date.now()): number[] {
  const today = dayOf(new Date(now).toISOString());
  const out = new Array<number>(n).fill(0);
  for (const r of rows) {
    if (!r.submitted_time) continue;
    const ago = Math.round((today - dayOf(r.submitted_time)) / DAY);
    if (ago >= 0 && ago < n) out[n - 1 - ago] = (out[n - 1 - ago] ?? 0) + 1;
  }
  return out;
}
