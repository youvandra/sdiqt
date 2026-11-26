import { describe, expect, it } from "vitest";
import { addressUrl, blockUrl, txUrl } from "../src/lib/links.ts";

describe("QoreChain Explorer links", () => {
  it("uppercases a tx hash and links a block height", () => {
    expect(txUrl("a93fed3a")).toBe("https://explore.qore.network/tx/A93FED3A");
    expect(blockUrl("10782136")).toBe("https://explore.qore.network/block/10782136");
  });

  it("links qor1 accounts only", () => {
    const op = "qor17fhcxn83a0l9lqs8dmyesp5xeqdxsphu0j87x3";
    expect(addressUrl(op)).toBe(`https://explore.qore.network/address/${op}`);
    expect(addressUrl("dev:1702485c0aad3646")).toBeUndefined();
  });
});
