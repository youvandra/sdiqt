import { Search } from "lucide-react";
import { useState } from "react";
import { SectionHead } from "../components/Ui.tsx";
import { api, usePolled } from "../lib/api.ts";
import { SITE, useDocumentTitle } from "../lib/dom.ts";
import { useFleet } from "../lib/fleet.ts";
import { RecentBatches } from "../sections/RecentBatches.tsx";
import { FleetActivity, FleetFacts, RollupTable } from "../sections/Rollups.tsx";

/** The explorer: every watched rollup, its activity and the newest batches. */
export function Explorer() {
  useDocumentTitle(`Explorer · ${SITE}`);
  const rollups = usePolled(api.rollups, "rollups", 30_000);
  const fleet = useFleet(rollups.data);
  const [query, setQuery] = useState("");
  const reference = rollups.data?.reference ?? "sdiqt-1";

  return (
    <>
      <section className="section explorer-head" aria-labelledby="explorer-title">
        <div className="section-head">
          <div className="section-head-text">
            <span className="eyebrow">Explorer</span>
            <h1 className="t-h2" id="explorer-title">
              Every rollup the watchtower checks.
            </h1>
            <p className="t-body">
              Each qledger-v1 rollup posts its entries on chain, so the watchtower re-executes every
              batch from chain data alone. sdiqt-1 also gets a STARK proof per batch.
            </p>
          </div>
          <div className="section-head-aside">
            <FleetFacts list={rollups.data} />
          </div>
        </div>
        <label className="search explorer-search">
          <Search size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder="Rollup, batch number or tx hash"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search rollups and batches"
          />
        </label>
      </section>

      <section className="section explorer-body" id="rollups" aria-label="Rollups">
        <FleetActivity list={rollups.data} fleet={fleet} />
        <RollupTable
          list={rollups.data}
          fleet={fleet}
          loading={rollups.loading}
          error={rollups.error}
          query={/^#?[0-9]+$/.test(query.trim()) || query.trim().length >= 16 ? "" : query}
        />
      </section>

      <section className="section" id="recent" aria-labelledby="recent-title">
        <SectionHead eyebrow="Recent" title="Newest batches on every rollup." id="recent-title">
          Open a batch to compare its roots and read its signed receipts.
        </SectionHead>
        <RecentBatches fleet={fleet.data} reference={reference} query={query} />
      </section>
    </>
  );
}
