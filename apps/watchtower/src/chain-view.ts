/** What the tower reads from QoreChain, behind an interface so tests need no node. */
import { isRestNotFound, type RdkClient } from "@qorechain/rdk";
import type { ChainRecord } from "./settle.ts";

export interface AnchorFact {
  layerHeight: number;
  stateRoot: string;
  anchoredAt: number;
}

export interface TowerChain {
  batch(rollupId: string, index: string): Promise<ChainRecord>;
  anchors(layerId: string): Promise<AnchorFact[]>;
  tip(): Promise<bigint>;
  retentionBlocks(): Promise<bigint>;
  challengeWindowSec(rollupId: string): Promise<number>;
}

const norm = (h: string) => h.replace(/^0x/, "").toLowerCase();

export function restChain(client: RdkClient): TowerChain {
  return {
    async batch(rollupId, index) {
      try {
        const b = await client.rest.getBatch(rollupId, BigInt(index));
        return {
          kind: "found",
          status: b.status,
          stateRoot: norm(b.stateRoot),
          withdrawalsRoot: norm(b.withdrawalsRoot),
          dataHash: norm(b.dataHash),
          submittedHeight: b.submittedAt,
          submittedTime: b.submittedTime,
        };
      } catch (err) {
        if (isRestNotFound(err)) return { kind: "missing" };
        throw err;
      }
    },
    async anchors(layerId) {
      try {
        return (await client.rest.getAnchors(layerId)).map((a) => ({
          layerHeight: a.layerHeight,
          stateRoot: norm(a.stateRoot),
          anchoredAt: a.anchoredAt,
        }));
      } catch (err) {
        if (isRestNotFound(err)) return [];
        throw err;
      }
    },
    tip: async () => BigInt(await client.rest.getLatestHeight()),
    retentionBlocks: async () =>
      BigInt((await client.rest.getParams()).finalizedBatchRetentionBlocks ?? 432_000),
    challengeWindowSec: async (rollupId) =>
      Number((await client.rest.getRollup(rollupId)).challengeWindowSec ?? 3600),
  };
}
