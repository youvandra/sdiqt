import { describe, expect, it } from "vitest";
import { wrapTab } from "../src/lib/dom.ts";

describe("wrapTab", () => {
  const items = ["close", "tab", "copy"];

  it("wraps from the last item to the first and back", () => {
    expect(wrapTab(items, "copy", false)).toBe("close");
    expect(wrapTab(items, "close", true)).toBe("copy");
  });

  it("leaves moves between inner items to the browser", () => {
    expect(wrapTab(items, "close", false)).toBeNull();
    expect(wrapTab(items, "tab", true)).toBeNull();
  });

  it("pulls focus that sits outside the trap back in", () => {
    expect(wrapTab(items, null, false)).toBe("close");
    expect(wrapTab(items, null, true)).toBe("copy");
    expect(wrapTab(items, "footer", false)).toBe("close");
  });

  it("has nothing to do without focusable items", () => {
    expect(wrapTab([], null, false)).toBeNull();
  });
});
