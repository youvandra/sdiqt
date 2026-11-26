/** Page buttons to show: first, last, the current page and its neighbours, gaps as null. */
export function pageList(current: number, total: number, around = 1): (number | null)[] {
  if (total <= 0) return [];
  const keep = new Set([1, total]);
  for (let p = current - around; p <= current + around; p++) if (p >= 1 && p <= total) keep.add(p);
  // A gap of exactly one page shows that page instead of an ellipsis.
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  for (const p of sorted) {
    const prev = out.length ? out[out.length - 1] : undefined;
    if (typeof prev === "number" && p - prev === 2) out.push(p - 1);
    else if (typeof prev === "number" && p - prev > 2) out.push(null);
    out.push(p);
  }
  return out;
}

/** Number of pages for `count` rows at `size` per page; at least 1. */
export const pageCount = (count: number, size: number) => Math.max(1, Math.ceil(count / size));
