import { describe, expect, it } from "vitest";
import { pageCount, pageList } from "../src/lib/paging.ts";

describe("pagination", () => {
  it("shows every page when there are few", () => {
    expect(pageList(1, 1)).toEqual([1]);
    expect(pageList(2, 4)).toEqual([1, 2, 3, 4]);
  });

  it("keeps first, last and neighbours, with gaps", () => {
    expect(pageList(1, 61)).toEqual([1, 2, null, 61]);
    expect(pageList(30, 61)).toEqual([1, null, 29, 30, 31, null, 61]);
    expect(pageList(61, 61)).toEqual([1, null, 60, 61]);
  });

  it("fills a one-page gap with that page", () => {
    expect(pageList(4, 10)).toEqual([1, 2, 3, 4, 5, null, 10]);
  });

  it("counts pages", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(1521, 25)).toBe(61);
  });
});
