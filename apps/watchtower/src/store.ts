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
  /** Roots the submission put on chain; null on rows stored before they were kept. */
  prev_state_root: string | null;
  state_root: string | null;
  withdrawals_root: string | null;
  data_hash: string | null;
  /** JSON `ApiProofClaim` of the last bundle checked for this submission. */
  claim: string | null;
}

/** The last finished tick, for `/api/health`. */
export interface PollRow {
  at: string;
  height: string;
  /** Challenge window of the rollup at this poll, in seconds. */
  window_s: string | null;
}

/** What the tower did about one mismatching submission. */
export interface ChallengeRow {
  key: string;
  rollup_id: string;
  batch_index: string;
  /**
   * watch: fraud confirmed locally, no challenger configured; refused: the local
   * check did not say fraud, nothing sent; failed: the send threw (retried);
   * sent: on chain; upheld: the batch was rejected; dismissed: it finalized.
   */
  status: "watch" | "refused" | "failed" | "sent" | "upheld" | "dismissed";
  reason: string | null;
  txhash: string | null;
  attempts: number;
  honest_state_root: string;
  at: string;
  resolved_at: string | null;
  /** The submission that later took this batch index, if any. */
  resubmitted_tx: string | null;
}

/** Columns added after the first release, with their SQL types. */
const ADDED_COLUMNS: Array<[keyof BatchRow, string]> = [
  ["prev_state_root", "TEXT"],
  ["state_root", "TEXT"],
  ["withdrawals_root", "TEXT"],
  ["data_hash", "TEXT"],
  ["claim", "TEXT"],
];

export class TowerStore {
  readonly db: DatabaseSync;

  /**
   * Open the store at `path`. With `readOnly` the file must already exist and
   * nothing is created or migrated: another process owns it (SQLite WAL lets
   * this reader see its commits).
   */
  constructor(path: string, opts: { readOnly?: boolean } = {}) {
    this.db = new DatabaseSync(path, opts.readOnly ? { readOnly: true } : {});
    if (opts.readOnly) return;
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
      CREATE TABLE IF NOT EXISTS challenges (
        key TEXT PRIMARY KEY, rollup_id TEXT NOT NULL, batch_index TEXT NOT NULL,
        status TEXT NOT NULL, reason TEXT, txhash TEXT, attempts INTEGER NOT NULL,
        honest_state_root TEXT NOT NULL, at TEXT NOT NULL, resolved_at TEXT, resubmitted_tx TEXT);
      CREATE TABLE IF NOT EXISTS polls (
        rollup_id TEXT PRIMARY KEY, at TEXT NOT NULL, height TEXT NOT NULL, window_s TEXT);
    `);
    const have = new Set(
      (this.db.prepare("PRAGMA table_info(batches)").all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    for (const [col, type] of ADDED_COLUMNS) {
      if (!have.has(col)) this.db.exec(`ALTER TABLE batches ADD COLUMN ${col} ${type}`);
    }
    const pollCols = new Set(
      (this.db.prepare("PRAGMA table_info(polls)").all() as Array<{ name: string }>).map(
        (c) => c.name,
      ),
    );
    if (!pollCols.has("window_s")) this.db.exec("ALTER TABLE polls ADD COLUMN window_s TEXT");
  }

  challenge(key: string): ChallengeRow | undefined {
    return this.db.prepare("SELECT * FROM challenges WHERE key = ?").get(key) as
      | ChallengeRow
      | undefined;
  }

  putChallenge(row: ChallengeRow): void {
    const cols = Object.keys(row);
    this.db
      .prepare(
        `INSERT INTO challenges (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
         ON CONFLICT(key) DO UPDATE SET ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`,
      )
      .run(...(Object.values(row) as Array<string | number | null>));
  }

  setPoll(rollupId: string, poll: PollRow): void {
    this.db
      .prepare(
        `INSERT INTO polls (rollup_id, at, height, window_s) VALUES (?, ?, ?, ?)
         ON CONFLICT(rollup_id) DO UPDATE SET
           at = excluded.at, height = excluded.height, window_s = excluded.window_s`,
      )
      .run(rollupId, poll.at, poll.height, poll.window_s);
  }

  lastPoll(rollupId: string): PollRow | undefined {
    return this.db
      .prepare("SELECT at, height, window_s FROM polls WHERE rollup_id = ?")
      .get(rollupId) as PollRow | undefined;
  }

  /** Every submission at one batch index, oldest first. */
  atIndex(rollupId: string, batchIndex: string): BatchRow[] {
    return this.db
      .prepare(
        "SELECT * FROM batches WHERE rollup_id = ? AND batch_index = ? ORDER BY CAST(height AS INTEGER)",
      )
      .all(rollupId, batchIndex) as unknown as BatchRow[];
  }

  /** Receipts of one submission with the time each was issued, oldest first. */
  timeline(key: string): Array<{ issued_at: string; receipt: SignedReceiptV1 }> {
    return (
      this.db
        .prepare("SELECT issued_at, receipt FROM receipts WHERE key = ? ORDER BY id")
        .all(key) as Array<{ issued_at: string; receipt: string }>
    ).map((r) => ({ issued_at: r.issued_at, receipt: JSON.parse(r.receipt) as SignedReceiptV1 }));
  }

  /** The most recent receipt across a rollup's submissions. */
  lastReceipt(
    rollupId: string,
  ): { key: string; issued_at: string; receipt: SignedReceiptV1 } | undefined {
    const r = this.db
      .prepare(
        `SELECT r.key, r.issued_at, r.receipt FROM receipts r JOIN batches b ON b.key = r.key
         WHERE b.rollup_id = ? ORDER BY r.id DESC LIMIT 1`,
      )
      .get(rollupId) as { key: string; issued_at: string; receipt: string } | undefined;
    return r && { key: r.key, issued_at: r.issued_at, receipt: JSON.parse(r.receipt) };
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
