/**
 * Which rollup a page shows and how far SDIQT checks it. `stark` rollups have
 * proofs (sdiqt-1); `reexec` rollups are re-executed from their public inbox
 * only, so every proof-related view is hidden for them.
 */
import type { CheckTier } from "@sdiqt/protocol";
import { createContext, useContext } from "react";
import { REFERENCE_ROLLUP, type RollupApi, rollupApi } from "./api.ts";

export interface RollupView {
  id: string;
  tier: CheckTier;
  api: RollupApi;
}

export const viewOf = (id: string): RollupView => ({
  id,
  tier: id === REFERENCE_ROLLUP ? "stark" : "reexec",
  api: rollupApi(id),
});

const RollupContext = createContext<RollupView>(viewOf(REFERENCE_ROLLUP));
export const RollupProvider = RollupContext.Provider;
export const useRollup = () => useContext(RollupContext);

/** Rollup page path, with an optional open batch. */
export function rollupPath(id: string, batch?: string, verify = false): string {
  const q = new URLSearchParams();
  if (batch !== undefined) q.set("batch", batch);
  if (verify) q.set("verify", "1");
  const qs = q.toString();
  return `/r/${encodeURIComponent(id)}${qs ? `?${qs}` : ""}`;
}
