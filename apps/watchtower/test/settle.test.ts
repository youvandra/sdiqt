import { describe, expect, it } from "vitest";
import { type SettleInput, settle, validity } from "../src/index.ts";

const base: SettleInput = {
  stateRoot: "aa",
  withdrawalsRoot: "bb",
  dataHash: "cc",
  height: 1_000n,
  record: {
    kind: "found",
    status: "pending",
    stateRoot: "aa",
    withdrawalsRoot: "bb",
    dataHash: "cc",
    submittedHeight: 1000,
    submittedTime: 1,
  },
  supersededLater: false,
  anchored: true,
  tipHeight: 2_000n,
  retentionBlocks: 432_000n,
};
const found = (status: string, over = {}) => ({
  ...base,
  record: { ...base.record, status, ...over } as SettleInput["record"],
});

describe("settlement", () => {
  it("reads the chain record while it exists", () => {
    expect(settle(found("pending")).settlement).toBe("pending");
    expect(settle(found("finalized")).settlement).toBe("final");
    expect(settle(found("rejected")).settlement).toBe("rejected");
  });

  it("calls a submission rejected when the record at its index holds other roots", () => {
    expect(settle(found("finalized", { withdrawalsRoot: "ff" })).settlement).toBe("rejected");
    expect(settle(found("finalized", { stateRoot: "ff" })).settlement).toBe("rejected");
  });

  it("calls a submission rejected when a later one reused its index", () => {
    expect(settle({ ...found("finalized"), supersededLater: true }).settlement).toBe("rejected");
  });

  it("keeps a final batch final after its record is pruned", () => {
    expect(settle({ ...base, record: { kind: "missing" }, previous: "final" })).toEqual({
      settlement: "final",
      pruned: true,
    });
  });

  it("settles a pruned batch from its anchor on a cold start, only past the retention window", () => {
    const missing = { ...base, record: { kind: "missing" } as const };
    expect(settle({ ...missing, tipHeight: 500_000n })).toEqual({
      settlement: "final",
      pruned: true,
    });
    expect(settle({ ...missing, tipHeight: 2_000n }).settlement).toBe("unknown");
    expect(settle({ ...missing, tipHeight: 500_000n, anchored: false }).settlement).toBe("unknown");
  });
});

describe("validity", () => {
  it("orders mismatch, proven, proving and unproven", () => {
    expect(validity({ mismatch: true, proven: true, now: 0, deadline: 1 })).toBe("mismatch");
    expect(validity({ mismatch: false, proven: true, now: 9, deadline: 1 })).toBe("proven");
    expect(validity({ mismatch: false, proven: false, now: 0, deadline: 1 })).toBe("proving");
    expect(validity({ mismatch: false, proven: false, now: 2, deadline: 1 })).toBe("unproven");
  });
});
