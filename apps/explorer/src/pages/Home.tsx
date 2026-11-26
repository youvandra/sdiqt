import { useCallback } from "react";
import { Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { api, REFERENCE_ROLLUP, usePolled } from "../lib/api.ts";
import { SITE, useDocumentTitle } from "../lib/dom.ts";
import { rollupPath } from "../lib/rollup.ts";
import { Builders } from "../sections/Builders.tsx";
import { Hero } from "../sections/Hero.tsx";
import { HowItWorks } from "../sections/HowItWorks.tsx";
import { Security } from "../sections/Security.tsx";
import { Verify } from "../sections/Verify.tsx";

/** Landing: what SDIQT is, its evidence, and how to check its work. The explorer is at /rollups. */
export function Home() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  useDocumentTitle(`${SITE} · Proof that outlives the chain`);
  const health = usePolled(api.health, "health");
  const list = usePolled(api.batches, "batches");
  const rollups = usePolled(api.rollups, "rollups", 30_000);
  const { hash } = useLocation();
  const counts = usePolled(api.counts, "counts", 60_000);
  const onVerify = useCallback(
    (i: string) => navigate(rollupPath(REFERENCE_ROLLUP, i, true)),
    [navigate],
  );

  // Links from before the multi-rollup explorer: `/?batch=N` was a sdiqt-1 batch.
  const legacy = params.get("batch");
  // The rollup list moved from `/#rollups` to its own page.
  if (hash === "#rollups") return <Navigate to="/rollups" replace />;
  if (legacy !== null)
    return (
      <Navigate to={rollupPath(REFERENCE_ROLLUP, legacy, params.get("verify") === "1")} replace />
    );

  const rows = list.data?.batches ?? [];
  return (
    <>
      <Hero
        health={health.data}
        error={health.error}
        rollups={rollups.data}
        counts={counts.data ?? null}
      />
      <Verify rows={rows} onVerify={onVerify} />
      <HowItWorks rows={rows} health={health.data} counts={counts.data ?? null} />
      <Security />
      <Builders />
    </>
  );
}
