import { describe, expect, it } from "vitest";
import { ago, entries, SETTLEMENT, shortHash, VALIDITY } from "../src/lib/format.ts";

describe("format", () => {
  it("shortens long hashes in the middle and leaves short ones alone", () => {
    expect(shortHash("28763ad839908f0858e28ee32c6fd6f7c0811cf26f5cab7e9841443ba2620e2d")).toBe(
      "28763ad8…620e2d",
    );
    expect(shortHash("abc")).toBe("abc");
  });

  it("counts inbox entries with an exclusive end", () => {
    expect(entries("4", "9")).toBe("5 entries");
    expect(entries("59", "60")).toBe("1 entry");
  });

  it("says how long ago in the largest whole unit", () => {
    const now = Date.parse("2026-11-25T00:00:00Z");
    expect(ago("2026-11-24T23:59:48Z", now)).toBe("12 s ago");
    expect(ago("2026-11-24T23:56:00Z", now)).toBe("4 min ago");
    expect(ago("2026-11-24T21:00:00Z", now)).toBe("3 h ago");
  });

  it("labels a rejected batch Void and a proven one Proven", () => {
    expect(SETTLEMENT.rejected).toMatchObject({ label: "Void", tone: "bad" });
    expect(VALIDITY.proven).toMatchObject({ label: "Proven", tone: "ok" });
  });
});
