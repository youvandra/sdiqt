/**
 * qledger state is a function of the inbox alone. `InboxReplay` executes the
 * archived entries in order and can hand out the ledger and accumulator at
 * any sequence, moving forward incrementally and restarting from empty when a
 * rollback moves the consumed position backwards.
 */
import {
  EMPTY_INBOX_ACC,
  executeQledger,
  hexToBytes,
  inboxAccumulate,
  type QledgerEntry,
  QledgerLedger,
} from "@qorechain/rdk";
import type { InboxRecord } from "@sdiqt/archiver";

export interface ReplayPoint {
  sequence: bigint;
  ledger: QledgerLedger;
  /** Accumulator at `sequence`; `EMPTY_INBOX_ACC` at 0. */
  acc: Uint8Array;
}

export const toEntry = (r: InboxRecord): QledgerEntry => ({
  height: BigInt(r.height),
  poster: r.poster,
  payload: hexToBytes(r.payload),
});

export class InboxReplay {
  private readonly chainId: string;
  private readonly rollupId: string;
  private entries: InboxRecord[] = [];
  private point: ReplayPoint = { sequence: 0n, ledger: new QledgerLedger(), acc: EMPTY_INBOX_ACC };

  constructor(chainId: string, rollupId: string) {
    this.chainId = chainId;
    this.rollupId = rollupId;
  }

  /** Replace the archive view (entries sorted from sequence 1). */
  setEntries(entries: InboxRecord[]): void {
    this.entries = entries;
  }

  get head(): bigint {
    return BigInt(this.entries.length);
  }

  /** Entries `from + 1 ..= to`. */
  range(from: bigint, to: bigint): QledgerEntry[] {
    if (to > this.head) throw new Error(`archive holds ${this.head} entries, ${to} needed`);
    return this.entries.slice(Number(from), Number(to)).map(toEntry);
  }

  records(from: bigint, to: bigint): InboxRecord[] {
    return this.entries.slice(Number(from), Number(to));
  }

  /** The ledger and accumulator after entry `sequence` (a private copy). */
  at(sequence: bigint): ReplayPoint {
    if (sequence < this.point.sequence) {
      this.point = { sequence: 0n, ledger: new QledgerLedger(), acc: EMPTY_INBOX_ACC };
    }
    const env = { chainId: this.chainId, rollupId: this.rollupId };
    const records = this.records(this.point.sequence, sequence);
    if (BigInt(records.length) !== sequence - this.point.sequence) {
      throw new Error(`archive holds ${this.head} entries, ${sequence} needed`);
    }
    let acc = this.point.acc;
    let seq = this.point.sequence;
    for (const r of records) {
      seq += 1n;
      if (r.sequence !== seq.toString())
        throw new Error(`archive entry ${r.sequence} is not sequence ${seq}`);
      acc = inboxAccumulate({
        chainId: this.chainId,
        rollupId: this.rollupId,
        prevAcc: acc,
        sequence: seq,
        height: BigInt(r.height),
        poster: r.poster,
        dataHash: r.data_hash,
      });
    }
    executeQledger(env, this.point.ledger, records.map(toEntry));
    this.point = { sequence, ledger: this.point.ledger, acc };
    return { sequence, ledger: this.point.ledger.clone(), acc };
  }
}
