/**
 * The tower's state in one SQLite file (`node:sqlite`, no native module):
 * one row per archived batch submission, plus every receipt it issued, so
 * the explorer can show each batch's timeline (Pending, Proven, Final).
 */
import { DatabaseSync } from "node:sqlite";
import type { SignedReceiptV1 } from "@sdiqt/protocol";

export interface BatchRow {
  key: string;
  rollup_id: string;
  batch_index: string;
  txhash: string;
  height: string;
  submitter: string;
  inbox: string;
  judged: "match" | "mismatch";
  differs: string;
  settlement: string;
  validity: string;
  pruned: number;
  submitted_time: number | null;
  qstr_tx: string | null;
  bundle_ms: number | null;
  note: string | null;
  updated_at: string;
}

export class TowerStore {
  readonly db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS batches (
        key TEXT PRIMARY KEY, rollup_id TEXT NOT NULL, batch_index TEXT NOT NULL,
        txhash TEXT NOT NULL, height TEXT NOT NULL, submitter TEXT NOT NULL, inbox TEXT NOT NULL,
        judged TEXT NOT NULL, differs TEXT NOT NULL, settlement TEXT NOT NULL, validity TEXT NOT NULL,
        pruned INTEGER NOT NULL DEFAULT 0, submitted_time INTEGER, qstr_tx TEXT, bundle_ms REAL,
        note TEXT, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS receipts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT NOT NULL, issued_at TEXT NOT NULL,
        state TEXT NOT NULL, receipt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS receipts_key ON receipts(key, id);
    `);
  }

  get(key: string): BatchRow | undefined {
    return this.db.prepare("SELECT * FROM batches WHERE key = ?").get(key) as BatchRow | undefined;
  }

  put(row: BatchRow): void {
    const cols = Object.keys(row);
    this.db
      .prepare(
        `INSERT INTO batches (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
         ON CONFLICT(key) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`,
      )
      .run(...(Object.values(row) as Array<string | number | null>));
  }

  list(rollupId: string): BatchRow[] {
    return this.db
      .prepare("SELECT * FROM batches WHERE rollup_id = ? ORDER BY CAST(height AS INTEGER)")
      .all(rollupId) as unknown as BatchRow[];
  }

  latestReceipt(key: string): { state: string; receipt: SignedReceiptV1 } | undefined {
    const r = this.db
      .prepare("SELECT state, receipt FROM receipts WHERE key = ? ORDER BY id DESC LIMIT 1")
      .get(key) as { state: string; receipt: string } | undefined;
    return r && { state: r.state, receipt: JSON.parse(r.receipt) as SignedReceiptV1 };
  }

  receipts(key: string): SignedReceiptV1[] {
    return (
      this.db.prepare("SELECT receipt FROM receipts WHERE key = ? ORDER BY id").all(key) as Array<{
        receipt: string;
      }>
    ).map((r) => JSON.parse(r.receipt) as SignedReceiptV1);
  }

  addReceipt(key: string, state: string, receipt: SignedReceiptV1, at: string): void {
    this.db
      .prepare("INSERT INTO receipts (key, issued_at, state, receipt) VALUES (?, ?, ?, ?)")
      .run(key, at, state, JSON.stringify(receipt));
  }

  close(): void {
    this.db.close();
  }
}
