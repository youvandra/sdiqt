import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { RdkClient } from "@qorechain/rdk";
import { describe, expect, it } from "vitest";
import {
  ArchiveError,
  ArchiveLagError,
  catchUp,
  DEPOSIT_EVENT,
  depositRecords,
  replayAccumulator,
  type TxResponse,
} from "../src/index.ts";

const ROLLUP = "test-rollup";
const CHAIN = "test-chain";
const ev = (type: string, a: Record<string, string>) => ({
  type,
  attributes: Object.entries(a).map(([key, value]) => ({ key, value })),
});
const deposit = (sequence: string, height: string): TxResponse => ({
  height,
  txhash: `D${sequence}`,
  events: [
    ev(DEPOSIT_EVENT, {
      rollup_id: ROLLUP,
      sequence,
      depositor: "qor1alice",
      account: "11".repeat(32),
      amount: "5000uqor",
    }),
  ],
});

/** A client whose tx index holds `indexed` while the inbox head is `head`. */
function fakeClient(indexed: TxResponse[], head: number, headAcc: string): RdkClient {
  return {
    rest: {
      searchTxs: async (q: string) => (q.startsWith(DEPOSIT_EVENT) ? indexed : []),
      getInbox: async () => ({ headSequence: String(head), headAcc }),
    },
  } as unknown as RdkClient;
}

describe("catchUp", () => {
  const all = [deposit("1", "10"), deposit("2", "11")];
  const acc = replayAccumulator(CHAIN, ROLLUP, depositRecords(ROLLUP, all));

  it("reports an index that trails the head as lag and writes nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdiqt-archive-"));
    const run = catchUp({
      client: fakeClient(all.slice(0, 1), 2, acc),
      chainId: CHAIN,
      rollupId: ROLLUP,
      dir,
    });
    await expect(run).rejects.toThrow(ArchiveLagError);
    expect(await readdir(dir)).toEqual([]);
  });

  it("still treats a wrong accumulator as a hard error", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdiqt-archive-"));
    const run = catchUp({
      client: fakeClient(all, 2, "00".repeat(32)),
      chainId: CHAIN,
      rollupId: ROLLUP,
      dir,
    });
    await expect(run).rejects.toThrow(ArchiveError);
    await expect(run).rejects.not.toThrow(ArchiveLagError);
  });

  it("archives entries past the head and checks up to the head", async () => {
    const dir = await mkdtemp(join(tmpdir(), "sdiqt-archive-"));
    const one = replayAccumulator(CHAIN, ROLLUP, depositRecords(ROLLUP, all.slice(0, 1)));
    const run = await catchUp({
      client: fakeClient(all, 1, one),
      chainId: CHAIN,
      rollupId: ROLLUP,
      dir,
    });
    expect(run).toMatchObject({ entries: 2, headSequence: "1", headAccMatches: true });
  });
});
