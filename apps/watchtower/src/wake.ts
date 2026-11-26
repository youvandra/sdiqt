/**
 * Waits between tower ticks, but wakes early when the rollup's latest batch
 * changes. A fraud race is decided in seconds (26 Nov: another challenger won
 * by 7 s against a 30 s poll), so the tower probes one cheap REST read every
 * few seconds and runs its full tick as soon as a new submission lands.
 */

/** Identity of the newest batch on chain, or null when the rollup has none. */
export type LatestBatch = { index: number; height: number } | null;

export interface WakeOptions {
  /** Longest wait between ticks (the old fixed interval). */
  intervalMs: number;
  /** How often to probe for a new batch. 0 turns probing off. */
  probeMs: number;
  /** Reads the newest batch; errors are reported and the wait goes on. */
  probe: () => Promise<LatestBatch>;
  onProbeError?: (err: unknown) => void;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const sameBatch = (a: LatestBatch, b: LatestBatch) =>
  a === b || (a !== null && b !== null && a.index === b.index && a.height === b.height);

export class Waker {
  private seen: LatestBatch | undefined;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;
  private readonly o: WakeOptions;

  constructor(o: WakeOptions) {
    this.o = o;
    this.sleep = o.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.now = o.now ?? Date.now;
  }

  /**
   * Record the batch the tick just saw, so the next wait wakes only on a newer
   * one. Called right before each tick.
   */
  async mark(): Promise<void> {
    if (this.o.probeMs <= 0) return;
    try {
      this.seen = await this.o.probe();
    } catch (err) {
      this.o.onProbeError?.(err);
    }
  }

  /**
   * Resolve after `intervalMs`, or earlier with `"new_batch"` once the probe
   * shows a batch different from the one marked. A resubmission at the same
   * index after a rollback counts as new (its height differs).
   */
  async wait(): Promise<"interval" | "new_batch"> {
    const until = this.now() + this.o.intervalMs;
    if (this.o.probeMs <= 0) {
      await this.sleep(this.o.intervalMs);
      return "interval";
    }
    for (;;) {
      const left = until - this.now();
      if (left <= 0) return "interval";
      await this.sleep(Math.min(this.o.probeMs, left));
      if (this.now() >= until) return "interval";
      let latest: LatestBatch;
      try {
        latest = await this.o.probe();
      } catch (err) {
        this.o.onProbeError?.(err);
        continue;
      }
      if (this.seen === undefined) {
        this.seen = latest;
        continue;
      }
      if (!sameBatch(latest, this.seen)) return "new_batch";
    }
  }
}
