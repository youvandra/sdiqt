/**
 * The watchtower's read-only JSON API, served from its SQLite store. Every
 * response is built to a shared schema in `@sdiqt/protocol` and parsed before
 * it leaves, so the explorer never sees a shape the schema does not allow.
 *
 *   GET /api/health          last poll, lag, last receipt (503 when stale)
 *   GET /api/batches         latest submission at each batch index
 *   GET /api/batches/:i      every submission at index i: chain roots, proof claim, timeline
 *   GET /api/receipts/:i     the current submission's latest signed receipt, as JCS
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  API_MAX_POLL_LAG_S,
  ApiBatchDetailV1,
  ApiBatchListV1,
  ApiHealthV1,
  ApiProofClaim,
  ApiReceiptV1,
  canonicalize,
  DecimalString,
} from "@sdiqt/protocol";
import type { BatchRow, TowerStore } from "./store.ts";

export interface ApiOptions {
  store: TowerStore;
  rollupId: string;
  maxLagS?: bigint;
  now?: () => Date;
  /** Called with errors that become a 500, which hides their text from clients. */
  onError?: (err: unknown) => void;
}

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const iso = (unix: number) => new Date(unix * 1000).toISOString().replace(".000Z", "Z");
const isoAt = (s: string) => new Date(s).toISOString();
const txOf = (key: string) => key.slice(0, key.lastIndexOf(":"));
const msgIndexOf = (key: string) => key.slice(key.lastIndexOf(":") + 1);

function index(raw: string): string {
  if (!DecimalString.safeParse(raw).success)
    throw new HttpError(400, "batch index must be a decimal");
  return raw;
}

/** The latest submission at each index (the one the chain currently holds). */
function latestPerIndex(rows: BatchRow[]): Map<string, { row: BatchRow; count: number }> {
  const out = new Map<string, { row: BatchRow; count: number }>();
  for (const r of rows) {
    const cur = out.get(r.batch_index);
    if (!cur) out.set(r.batch_index, { row: r, count: 1 });
    else
      out.set(r.batch_index, {
        row: BigInt(r.height) >= BigInt(cur.row.height) ? r : cur.row,
        count: cur.count + 1,
      });
  }
  return out;
}

export function health(o: ApiOptions): { status: number; body: ApiHealthV1 } {
  const maxLag = o.maxLagS ?? API_MAX_POLL_LAG_S;
  const poll = o.store.lastPoll(o.rollupId);
  const now = (o.now ? o.now() : new Date()).getTime();
  const lag = poll ? BigInt(Math.max(0, Math.floor((now - Date.parse(poll.at)) / 1000))) : null;
  const ok = lag !== null && lag <= maxLag;
  const last = o.store.lastReceipt(o.rollupId);
  const body = ApiHealthV1.parse({
    status: ok ? "ok" : "stale",
    rollup_id: o.rollupId,
    last_poll_at: poll ? isoAt(poll.at) : null,
    last_poll_height: poll?.height ?? null,
    lag_s: lag === null ? null : lag.toString(),
    max_lag_s: maxLag.toString(),
    challenge_window_s: poll?.window_s ?? null,
    batches: String(o.store.list(o.rollupId).length),
    last_receipt: last
      ? {
          batch_index: last.receipt.body.batch_index,
          submit_tx: txOf(last.key),
          settlement: last.receipt.body.settlement,
          validity: last.receipt.body.validity,
          issued_at: isoAt(last.issued_at),
        }
      : null,
  });
  return { status: ok ? 200 : 503, body };
}

export function batchList(o: ApiOptions): ApiBatchListV1 {
  const latest = [...latestPerIndex(o.store.list(o.rollupId)).values()].sort((a, b) =>
    Number(BigInt(a.row.batch_index) - BigInt(b.row.batch_index)),
  );
  return ApiBatchListV1.parse({
    rollup_id: o.rollupId,
    batches: latest.map(({ row, count }) => {
      const [from, end] = row.inbox.split("..");
      return {
        batch_index: row.batch_index,
        submit_tx: row.txhash,
        submit_height: row.height,
        inbox_from: from,
        inbox_end: end,
        judged: row.judged,
        settlement: row.settlement,
        validity: row.validity,
        proven: row.validity === "proven",
        submissions: String(count),
        submitted_time: row.submitted_time === null ? null : iso(row.submitted_time),
      };
    }),
  });
}

export function batchDetail(o: ApiOptions, i: string): ApiBatchDetailV1 {
  const rows = o.store.atIndex(o.rollupId, index(i));
  if (rows.length === 0) throw new HttpError(404, `no batch ${i} on ${o.rollupId}`);
  return ApiBatchDetailV1.parse({
    rollup_id: o.rollupId,
    batch_index: i,
    submissions: rows.map((r) => {
      const [from, end] = r.inbox.split("..");
      const roots =
        r.prev_state_root && r.state_root && r.withdrawals_root !== null && r.data_hash
          ? {
              prev_state_root: r.prev_state_root,
              state_root: r.state_root,
              withdrawals_root: r.withdrawals_root,
              data_hash: r.data_hash,
            }
          : null;
      return {
        submit_tx: txOf(r.key),
        msg_index: msgIndexOf(r.key),
        submit_height: r.height,
        submitter: r.submitter,
        inbox_from: from,
        inbox_end: end,
        submitted_time: r.submitted_time === null ? null : iso(r.submitted_time),
        chain: roots,
        judged: r.judged,
        differs: JSON.parse(r.differs) as string[],
        settlement: r.settlement,
        validity: r.validity,
        pruned: r.pruned === 1,
        qstr_tx: r.qstr_tx?.toUpperCase() ?? null,
        claim: r.claim ? ApiProofClaim.parse(JSON.parse(r.claim)) : null,
        note: r.note,
        challenge: challengeOf(o.store, r.key),
        timeline: o.store.timeline(r.key).map((t) => ({
          settlement: t.receipt.body.settlement,
          validity: t.receipt.body.validity,
          issued_at: isoAt(t.issued_at),
        })),
      };
    }),
  });
}

function challengeOf(store: TowerStore, key: string) {
  const c = store.challenge(key);
  return c
    ? {
        status: c.status,
        reason: c.reason,
        challenge_tx: c.txhash?.toUpperCase() ?? null,
        honest_state_root: c.honest_state_root,
        at: isoAt(c.at),
        resolved_at: c.resolved_at ? isoAt(c.resolved_at) : null,
        resubmitted_tx: c.resubmitted_tx?.toUpperCase() ?? null,
      }
    : null;
}

export function receipt(o: ApiOptions, i: string): ApiReceiptV1 {
  const rows = o.store.atIndex(o.rollupId, index(i));
  const current = rows.at(-1);
  if (!current) throw new HttpError(404, `no batch ${i} on ${o.rollupId}`);
  const r = o.store.latestReceipt(current.key);
  if (!r) throw new HttpError(404, `no receipt yet for batch ${i}: ${current.note ?? "pending"}`);
  return ApiReceiptV1.parse(r.receipt);
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = canonicalize(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "x-content-type-options": "nosniff",
  });
  res.end(text);
}

/** Route one request; exported for tests that skip the socket. */
export function handle(o: ApiOptions, req: IncomingMessage, res: ServerResponse): void {
  try {
    if (req.method !== "GET") throw new HttpError(405, "read-only API");
    const path = new URL(req.url ?? "/", "http://tower").pathname.replace(/\/+$/, "");
    const [, root, route, arg, extra] = path.split("/");
    if (root !== "api" || extra !== undefined) throw new HttpError(404, "no such route");
    if (route === "health" && arg === undefined) {
      const h = health(o);
      send(res, h.status, h.body);
    } else if (route === "batches" && arg === undefined) send(res, 200, batchList(o));
    else if (route === "batches" && arg) send(res, 200, batchDetail(o, arg));
    else if (route === "receipts" && arg) send(res, 200, receipt(o, arg));
    else throw new HttpError(404, "no such route");
  } catch (err) {
    if (err instanceof HttpError) send(res, err.status, { error: err.message });
    else {
      o.onError?.(err);
      send(res, 500, { error: "internal error" });
    }
  }
}

export function createApiServer(o: ApiOptions): Server {
  return createServer((req, res) => handle(o, req, res));
}
