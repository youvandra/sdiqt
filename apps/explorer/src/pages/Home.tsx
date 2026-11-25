import { useCallback, useState } from "react";
import { useSearchParams } from "react-router";
import { BatchDrawer } from "../detail/BatchDrawer.tsx";
import { api, usePolled } from "../lib/api.ts";
import { type Filter, NO_FILTER } from "../lib/filters.ts";
import { Batches } from "../sections/Batches.tsx";
import { Builders } from "../sections/Builders.tsx";
import { Hero } from "../sections/Hero.tsx";
import { HowItWorks } from "../sections/HowItWorks.tsx";
import { Overview } from "../sections/Overview.tsx";
import { Security } from "../sections/Security.tsx";
import { Verify } from "../sections/Verify.tsx";

/** The whole explorer on one page; `?batch=N` opens the batch drawer. */
export function Home() {
  const health = usePolled(api.health, "health");
  const list = usePolled(api.batches, "batches");
  const rows = list.data?.batches ?? [];
  const [filter, setFilterState] = useState<Filter>(NO_FILTER);
  const [params, setParams] = useSearchParams();
  const open = params.get("batch");
  const verify = params.get("verify") === "1";

  const setFilter = useCallback(
    (f: Partial<Filter>) => setFilterState((cur) => ({ ...cur, ...f })),
    [],
  );
  const filterAndShow = useCallback(
    (f: Partial<Filter>) => {
      setFilter(f);
      document.getElementById("batches")?.scrollIntoView({ behavior: "smooth" });
    },
    [setFilter],
  );
  const onOpen = useCallback(
    (i: string) =>
      setParams(
        (p) => {
          p.set("batch", i);
          return p;
        },
        { preventScrollReset: true },
      ),
    [setParams],
  );
  const onVerify = useCallback(
    (i: string) =>
      setParams(
        (p) => {
          p.set("batch", i);
          p.set("verify", "1");
          return p;
        },
        { preventScrollReset: true },
      ),
    [setParams],
  );
  const onClose = useCallback(
    () =>
      setParams(
        (p) => {
          p.delete("batch");
          p.delete("verify");
          return p;
        },
        { preventScrollReset: true },
      ),
    [setParams],
  );

  return (
    <>
      <Hero health={health.data} error={health.error} />
      <Overview rows={rows} health={health.data} onOpen={onOpen} onFilter={filterAndShow} />
      <Batches
        rows={rows}
        loading={list.loading}
        error={list.error}
        filter={filter}
        setFilter={setFilter}
        onOpen={onOpen}
      />
      <HowItWorks rows={rows} health={health.data} />
      <Verify rows={rows} onVerify={onVerify} />
      <Security />
      <Builders />
      {open !== null && /^[0-9]+$/.test(open) && (
        <BatchDrawer key={`${open}:${verify}`} index={open} onClose={onClose} verify={verify} />
      )}
    </>
  );
}
