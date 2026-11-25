/**
 * Watch-only towers for every qledger-v1 rollup on the chain. Each rollup has
 * its own archive and its own rows in one shared store; one rollup's failure
 * is logged and never stops the others.
 */
import type { LogEvent } from "@sdiqt/operator";

/** What the fleet reads about a rollup to decide whether it can check it. */
export interface RollupInfo {
  rollupId: string;
  executionVm?: string;
  sequencing?: string;
}

/**
 * Rollups SDIQT can re-execute: qledger-v1 state rules with a based inbox,
 * where every entry is public on QoreChain. Sorted by id.
 */
export function checkable(
  rollups: readonly RollupInfo[],
  exclude: readonly string[] = [],
): string[] {
  return rollups
    .filter((r) => r.executionVm === "qledger-v1" && r.sequencing === "based")
    .map((r) => r.rollupId)
    .filter((id) => !exclude.includes(id))
    .sort();
}

/** The part of a tower the fleet drives. */
export interface Tickable {
  tick(): Promise<{ batches: number; receipts: number }>;
}

export interface FleetOptions {
  /** The rollups to watch now; called again every `rediscoverEvery` ticks. */
  discover: () => Promise<string[]>;
  make: (rollupId: string) => Tickable;
  log: (e: LogEvent & { rollup?: string }) => void;
  rediscoverEvery?: number;
}

export class Fleet {
  private readonly o: FleetOptions;
  private readonly towers = new Map<string, Tickable>();
  private ticks = 0;

  constructor(o: FleetOptions) {
    this.o = o;
  }

  /** Watched rollup ids, in the order they were added. */
  get ids(): string[] {
    return [...this.towers.keys()];
  }

  private async sync(): Promise<void> {
    let ids: string[];
    try {
      ids = await this.o.discover();
    } catch (err) {
      this.o.log({ event: "discover_failed", alert: true, error: String(err) });
      return;
    }
    for (const id of ids) {
      if (this.towers.has(id)) continue;
      this.towers.set(id, this.o.make(id));
      this.o.log({ event: "watch_added", rollup: id });
    }
  }

  /** One pass over every rollup, one after another to bound memory. */
  async tick(): Promise<{ rollups: number; batches: number; receipts: number; failed: number }> {
    if (this.ticks % (this.o.rediscoverEvery ?? 30) === 0) await this.sync();
    this.ticks += 1;
    let batches = 0;
    let receipts = 0;
    let failed = 0;
    for (const [id, tower] of this.towers) {
      try {
        const r = await tower.tick();
        batches += r.batches;
        receipts += r.receipts;
      } catch (err) {
        failed += 1;
        this.o.log({ event: "error", alert: true, rollup: id, error: String(err) });
      }
    }
    return { rollups: this.towers.size, batches, receipts, failed };
  }
}
