import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bytesToHex, EMPTY_INBOX_ACC, inboxAccumulate, type RdkClient } from "@qorechain/rdk";
import {
  ArchiveError,
  BATCH_EVENT,
  type BatchRecord,
  batchRecords,
  DEPOSIT_EVENT,
  depositRecords,
  fromJsonl,
  type InboxRecord,
  inboxGaps,
  mergeBatches,
  mergeInbox,
  POST_EVENT,
  postRecords,
  type TxResponse,
  toJsonl,
} from "./records.ts";

export const INBOX_FILE = "inbox.jsonl";
export const BATCHES_FILE = "batches.jsonl";

export interface ArchiveRun {
  rollupId: string;
  /** Lowest height queried (inclusive); 0 on a first run. */
  fromHeight: string;
  entries: number;
  batches: number;
  newEntries: number;
  newBatches: number;
  /** Inbox head on the chain and whether the replayed accumulator matches it. */
  headSequence: string;
  headAccMatches: boolean;
}

/** The accumulator after replaying `entries` (which must start at sequence 1) from empty. */
export function replayAccumulator(
  chainId: string,
  rollupId: string,
  entries: InboxRecord[],
): string {
  let acc: Uint8Array = EMPTY_INBOX_ACC;
  entries.forEach((e, i) => {
    if (e.sequence !== String(i + 1)) throw new ArchiveError(`inbox entry ${i + 1} is missing`);
    acc = inboxAccumulate({
      chainId,
      rollupId,
      prevAcc: acc,
      sequence: BigInt(e.sequence),
      height: BigInt(e.height),
      poster: e.poster,
      dataHash: e.data_hash,
    });
  });
  return bytesToHex(acc);
}

async function readRecords<T>(path: string): Promise<T[]> {
  try {
    return fromJsonl<T>(await readFile(path, "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
}

export async function readArchive(
  dir: string,
): Promise<{ entries: InboxRecord[]; batches: BatchRecord[] }> {
  const [entries, batches] = await Promise.all([
    readRecords<InboxRecord>(join(dir, INBOX_FILE)),
    readRecords<BatchRecord>(join(dir, BATCHES_FILE)),
  ]);
  return { entries, batches };
}

function maxHeight(records: Array<{ height: string }>): bigint {
  return records.reduce((m, r) => (BigInt(r.height) > m ? BigInt(r.height) : m), 0n);
}

/**
 * Catch the archive of `rollupId` in `dir` up with the chain. It re-reads from
 * the highest archived height (inclusive) so a half-written block is never
 * skipped, merges, checks the replayed accumulator against the chain head and
 * writes both files atomically. Running it twice on the same history gives
 * identical files.
 */
export async function catchUp(input: {
  client: RdkClient;
  chainId: string;
  rollupId: string;
  dir: string;
  fromHeight?: bigint;
}): Promise<ArchiveRun> {
  const { client, chainId, rollupId, dir } = input;
  await mkdir(dir, { recursive: true });
  const old = await readArchive(dir);
  const from = input.fromHeight ?? maxHeight([...old.entries, ...old.batches]);

  const search = (event: string) => {
    const q = `${event}.rollup_id='${rollupId}'${from > 0n ? ` AND tx.height>=${from}` : ""}`;
    return client.rest.searchTxs(q, { maxPages: 1000 }) as Promise<TxResponse[]>;
  };
  const [posts, deposits, batches, inbox] = await Promise.all([
    search(POST_EVENT),
    search(DEPOSIT_EVENT),
    search(BATCH_EVENT),
    client.rest.getInbox(rollupId),
  ]);

  const entries = mergeInbox(
    old.entries,
    postRecords(rollupId, posts),
    depositRecords(rollupId, deposits),
  );
  const allBatches = mergeBatches(old.batches, batchRecords(rollupId, batches));

  const gaps = inboxGaps(entries);
  if (gaps.length > 0) {
    throw new ArchiveError(
      `inbox of ${rollupId} has gaps at ${gaps.slice(0, 5).join(", ")}; re-run with --from-height 0`,
    );
  }

  const head = String(inbox.headSequence);
  const upToHead = entries.filter((e) => BigInt(e.sequence) <= BigInt(head));
  const headAccMatches =
    upToHead.length === Number(head) &&
    replayAccumulator(chainId, rollupId, upToHead) ===
      inbox.headAcc.replace(/^0x/, "").toLowerCase();
  if (!headAccMatches) {
    throw new ArchiveError(
      `replayed inbox accumulator of ${rollupId} does not match the chain head ${head}`,
    );
  }

  await writeAtomic(join(dir, INBOX_FILE), toJsonl(entries));
  await writeAtomic(join(dir, BATCHES_FILE), toJsonl(allBatches));

  return {
    rollupId,
    fromHeight: from.toString(),
    entries: entries.length,
    batches: allBatches.length,
    newEntries: entries.length - old.entries.length,
    newBatches: allBatches.length - old.batches.length,
    headSequence: head,
    headAccMatches,
  };
}
