/**
 * Read-only client for the watchtower API. Every response is parsed with the
 * schema the watchtower itself uses (`@sdiqt/protocol`), so a shape change
 * fails here loudly instead of rendering wrong data.
 */
import {
  ApiBatchDetailV1,
  ApiBatchListV1,
  ApiErrorV1,
  ApiHealthV1,
  ApiReceiptV1,
} from "@sdiqt/protocol";
import { useEffect, useRef, useState } from "react";
import type { z } from "zod";

/** API origin; empty means same origin (`/api` proxied in dev and by nginx in production). */
const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function getParsed<S extends z.ZodType>(
  path: string,
  schema: S,
  okStatuses: readonly number[] = [200],
  signal?: AbortSignal,
): Promise<z.infer<S>> {
  const res = await fetch(`${API_BASE}${path}`, { signal: signal ?? null, cache: "no-store" });
  const body: unknown = await res.json().catch(() => null);
  if (!okStatuses.includes(res.status)) {
    const parsed = ApiErrorV1.safeParse(body);
    throw new ApiError(res.status, parsed.success ? parsed.data.error : `HTTP ${res.status}`);
  }
  return schema.parse(body);
}

export const api = {
  /** 503 still carries a valid body: the tower is stale, the explorer says so. */
  health: (signal?: AbortSignal) => getParsed("/api/health", ApiHealthV1, [200, 503], signal),
  batches: (signal?: AbortSignal) => getParsed("/api/batches", ApiBatchListV1, [200], signal),
  batch: (i: string, signal?: AbortSignal) =>
    getParsed(`/api/batches/${encodeURIComponent(i)}`, ApiBatchDetailV1, [200], signal),
  receipt: (i: string, signal?: AbortSignal) =>
    getParsed(`/api/receipts/${encodeURIComponent(i)}`, ApiReceiptV1, [200], signal),
};

export interface Polled<T> {
  data: T | undefined;
  error: string | undefined;
  loading: boolean;
}

/**
 * Load once, then refresh every `intervalMs`; keeps the last good data across
 * a failed poll. `key` names what is loaded: a new key starts over.
 */
export function usePolled<T>(
  load: (signal: AbortSignal) => Promise<T>,
  key: string,
  intervalMs = 15_000,
): Polled<T> {
  const [state, setState] = useState<Polled<T>>({
    data: undefined,
    error: undefined,
    loading: true,
  });
  const loadRef = useRef(load);
  loadRef.current = load;

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` restarts the poll; `load` is read through a ref
  useEffect(() => {
    let live = true;
    let ctrl = new AbortController();
    setState({ data: undefined, error: undefined, loading: true });
    const run = async () => {
      ctrl = new AbortController();
      try {
        const data = await loadRef.current(ctrl.signal);
        if (live) setState({ data, error: undefined, loading: false });
      } catch (err) {
        if (!live || ctrl.signal.aborted) return;
        const message = err instanceof Error ? err.message : String(err);
        setState((s) => ({ data: s.data, error: message, loading: false }));
      }
    };
    void run();
    const timer = window.setInterval(run, intervalMs);
    return () => {
      live = false;
      ctrl.abort();
      window.clearInterval(timer);
    };
  }, [key, intervalMs]);

  return state;
}
