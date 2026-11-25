import type { ArchivedQstr } from "@sdiqt/operator";
import type { QstrV1 } from "@sdiqt/protocol";
import { describe, expect, it } from "vitest";
import { qstrForRoots } from "../src/tower.ts";

const root = (n: number) => n.toString(16).padStart(64, "0");

function posted(sequence: string, edit: Partial<QstrV1> = {}): ArchivedQstr {
  return {
    sequence,
    txhash: `TX${sequence}`,
    poster: "qor1operator",
    qstr: { batchIndex: "3", stateRoot: root(7), inboxEnd: "8", ...edit } as QstrV1,
  };
}

const batch = { batch_index: "3", state_root: root(7), inbox_end: "8" };

describe("qstrForRoots", () => {
  it("matches the QSTR for exactly the batch's index, state root and inbox end", () => {
    expect(qstrForRoots([posted("9")], batch)?.sequence).toBe("9");
  });

  it("refuses a QSTR for the same index with another state root", () => {
    expect(qstrForRoots([posted("9", { stateRoot: root(6) })], batch)).toBeUndefined();
  });

  it("refuses a QSTR for the same index with another inbox end", () => {
    expect(qstrForRoots([posted("9", { inboxEnd: "7" })], batch)).toBeUndefined();
  });

  it("refuses a QSTR for another batch index with the same roots", () => {
    expect(qstrForRoots([posted("9", { batchIndex: "2" })], batch)).toBeUndefined();
  });

  it("skips a QSTR for a replaced batch and finds the one for the current roots", () => {
    const old = posted("9", { stateRoot: root(6) });
    const now = posted("12");
    expect(qstrForRoots([old, now], batch)?.sequence).toBe("12");
  });

  it("takes the first posted when two QSTRs name the same batch", () => {
    expect(qstrForRoots([posted("9"), posted("12")], batch)?.sequence).toBe("9");
  });

  it("finds nothing in an empty archive", () => {
    expect(qstrForRoots([], batch)).toBeUndefined();
  });
});
