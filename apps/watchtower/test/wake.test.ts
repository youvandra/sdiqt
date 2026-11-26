import { describe, expect, it } from "vitest";
import { type LatestBatch, Waker } from "../src/wake.ts";

function clock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("Waker", () => {
  it("waits the full interval when no new batch lands", async () => {
    const c = clock();
    const w = new Waker({
      intervalMs: 30_000,
      probeMs: 3_000,
      probe: async () => ({ index: 4, height: 100 }),
      ...c,
    });
    await w.mark();
    expect(await w.wait()).toBe("interval");
    expect(c.now()).toBe(30_000);
  });

  it("wakes on the first probe that shows a new batch", async () => {
    const c = clock();
    let latest: LatestBatch = { index: 4, height: 100 };
    const w = new Waker({
      intervalMs: 30_000,
      probeMs: 3_000,
      probe: async () => {
        if (c.now() >= 9_000) latest = { index: 5, height: 104 };
        return latest;
      },
      ...c,
    });
    await w.mark();
    expect(await w.wait()).toBe("new_batch");
    expect(c.now()).toBe(9_000);
  });

  it("treats a resubmission at the same index as new", async () => {
    const c = clock();
    let latest: LatestBatch = { index: 12, height: 200 };
    const w = new Waker({
      intervalMs: 30_000,
      probeMs: 3_000,
      probe: async () => {
        if (c.now() >= 6_000) latest = { index: 12, height: 260 };
        return latest;
      },
      ...c,
    });
    await w.mark();
    expect(await w.wait()).toBe("new_batch");
  });

  it("wakes when the first batch of an empty rollup appears", async () => {
    const c = clock();
    let latest: LatestBatch = null;
    const w = new Waker({
      intervalMs: 30_000,
      probeMs: 3_000,
      probe: async () => {
        if (c.now() >= 3_000) latest = { index: 0, height: 1 };
        return latest;
      },
      ...c,
    });
    await w.mark();
    expect(await w.wait()).toBe("new_batch");
  });

  it("keeps waiting through probe errors and reports them", async () => {
    const c = clock();
    const errors: unknown[] = [];
    let calls = 0;
    const w = new Waker({
      intervalMs: 12_000,
      probeMs: 3_000,
      probe: async () => {
        calls++;
        if (calls > 1) throw new Error("503");
        return { index: 1, height: 1 };
      },
      onProbeError: (e) => errors.push(e),
      ...c,
    });
    await w.mark();
    expect(await w.wait()).toBe("interval");
    expect(errors.length).toBe(3);
  });

  it("learns the baseline in wait() when mark() failed", async () => {
    const c = clock();
    let calls = 0;
    const w = new Waker({
      intervalMs: 30_000,
      probeMs: 3_000,
      probe: async () => {
        calls++;
        if (calls === 1) throw new Error("timeout");
        return { index: 7, height: 50 };
      },
      onProbeError: () => {},
      ...c,
    });
    await w.mark();
    expect(await w.wait()).toBe("interval");
  });

  it("sleeps the plain interval with probing off", async () => {
    const c = clock();
    let calls = 0;
    const w = new Waker({
      intervalMs: 30_000,
      probeMs: 0,
      probe: async () => {
        calls++;
        return null;
      },
      ...c,
    });
    await w.mark();
    expect(await w.wait()).toBe("interval");
    expect(calls).toBe(0);
    expect(c.now()).toBe(30_000);
  });
});
