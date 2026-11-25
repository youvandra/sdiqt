/**
 * The exit desk: the watchtower's side of exit packets v1.
 *
 * - `accept` keeps the newest packet per account. A packet must be for this
 *   chain, rollup, tower and KEM key, and its header must be signed by the
 *   account's own ML-DSA-44 key; a seq at or below the stored one, or at or
 *   below a cancel, is refused.
 * - `cancel` takes a signed cancel and drops every packet up to its seq.
 * - `tick` runs at each tower tick. For each held packet whose release height
 *   the chain has reached, it opens the packet; a packet whose nonce the
 *   account already used is stale and dropped, anything that fails to open is
 *   rejected, and the rest is posted to the based inbox. The operator's next
 *   batch then includes the withdrawal in inbox order.
 */
import type { DatabaseSync } from "node:sqlite";
import type { SealKeyPair } from "@qorechain/qoreseal";
import type { LogEvent } from "@sdiqt/operator";
import { accountMatchesKey, kemKeySha256, openExitPacket } from "@sdiqt/operator";
import { ExitCancelV1, ExitPacketV1, fromHex, verifyExitDocument } from "@sdiqt/protocol";

export type ExitStatus = "held" | "posted" | "stale" | "cancelled" | "rejected";

export interface ExitRow {
  account: string;
  rollup_id: string;
  seq: string;
  release_height: string;
  status: ExitStatus;
  packet: string | null;
  reason: string | null;
  cancelled_seq: string | null;
  post_tx: string | null;
  attempts: number;
  updated_at: string;
}

/** The status the API shows; never the envelope. Integers as strings (JCS). */
export type ExitView = Omit<ExitRow, "packet" | "attempts"> & { attempts: string };

export interface ExitDeskOptions {
  db: DatabaseSync;
  chainId: string;
  rollupId: string;
  /** The tower's account, which packets must name. */
  tower: string;
  /** The tower's QoreSeal keys; its ML-KEM key must be the registered one. */
  kemKeys: SealKeyPair;
  /** Posts a payload to the rollup inbox and returns the tx hash. Without it, held packets wait. */
  post?: (data: Uint8Array, label: string) => Promise<{ txhash: string }>;
  log: (e: LogEvent) => void;
  now?: () => Date;
}

/** A failed post is retried on later ticks up to this many times. */
export const MAX_EXIT_POST_ATTEMPTS = 3;

export class ExitRefused extends Error {}

export class ExitDesk {
  private readonly o: ExitDeskOptions;
  private readonly kemSha: string;

  constructor(o: ExitDeskOptions) {
    this.o = o;
    this.kemSha = kemKeySha256(o.kemKeys.mlkemPublicKey);
    o.db.exec(`
      CREATE TABLE IF NOT EXISTS exits (
        account TEXT NOT NULL, rollup_id TEXT NOT NULL, seq TEXT NOT NULL,
        release_height TEXT NOT NULL, status TEXT NOT NULL, packet TEXT, reason TEXT,
        cancelled_seq TEXT, post_tx TEXT, attempts INTEGER NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (rollup_id, account));
    `);
  }

  private at(): string {
    return (this.o.now ? this.o.now() : new Date()).toISOString();
  }

  get(account: string): ExitRow | undefined {
    return this.o.db
      .prepare("SELECT * FROM exits WHERE rollup_id = ? AND account = ?")
      .get(this.o.rollupId, account) as ExitRow | undefined;
  }

  view(account: string): ExitView | undefined {
    const r = this.get(account);
    if (!r) return undefined;
    const { packet: _packet, attempts, ...rest } = r;
    return { ...rest, attempts: String(attempts) };
  }

  private put(row: ExitRow): void {
    const cols = Object.keys(row);
    this.o.db
      .prepare(
        `INSERT INTO exits (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})
         ON CONFLICT(rollup_id, account) DO UPDATE SET
         ${cols.map((c) => `${c} = excluded.${c}`).join(", ")}`,
      )
      .run(...(Object.values(row) as Array<string | number | null>));
  }

  /** Store a packet as the account's newest. Throws `ExitRefused` with the reason. */
  accept(input: unknown): ExitView {
    const parsed = ExitPacketV1.safeParse(input);
    if (!parsed.success) throw new ExitRefused(`not an exit packet v1: ${parsed.error.message}`);
    const p = parsed.data;
    const h = p.header;
    if (h.chain_id !== this.o.chainId) throw new ExitRefused(`packet is for chain ${h.chain_id}`);
    if (h.rollup_id !== this.o.rollupId)
      throw new ExitRefused(`packet is for rollup ${h.rollup_id}`);
    if (h.tower !== this.o.tower) throw new ExitRefused(`packet is sealed to ${h.tower}`);
    if (h.tower_kem_sha256 !== this.kemSha)
      throw new ExitRefused("packet is sealed to another KEM key");
    if (!accountMatchesKey(h.account, h.public_key))
      throw new ExitRefused("account id does not match the public key");
    if (!verifyExitDocument(h, fromHex(p.header_sig), fromHex(h.public_key)))
      throw new ExitRefused("header signature invalid");

    const cur = this.get(h.account);
    const seq = BigInt(h.seq);
    if (
      cur?.cancelled_seq !== null &&
      cur?.cancelled_seq !== undefined &&
      seq <= BigInt(cur.cancelled_seq)
    )
      throw new ExitRefused(`seq ${h.seq} was cancelled`);
    if (cur && cur.status !== "cancelled" && seq <= BigInt(cur.seq))
      throw new ExitRefused(`seq ${h.seq} is not newer than stored seq ${cur.seq}`);

    this.put({
      account: h.account,
      rollup_id: h.rollup_id,
      seq: h.seq,
      release_height: h.release_height,
      status: "held",
      packet: JSON.stringify(p),
      reason: null,
      cancelled_seq: cur?.cancelled_seq ?? null,
      post_tx: null,
      attempts: 0,
      updated_at: this.at(),
    });
    this.o.log({
      event: "exit_held",
      account: h.account,
      seq: h.seq,
      release_height: h.release_height,
    });
    return this.view(h.account) as ExitView;
  }

  /** Apply a signed cancel. Throws `ExitRefused` with the reason. */
  cancel(input: unknown): ExitView {
    const parsed = ExitCancelV1.safeParse(input);
    if (!parsed.success) throw new ExitRefused(`not an exit cancel v1: ${parsed.error.message}`);
    const { body, sig } = parsed.data;
    if (body.chain_id !== this.o.chainId || body.rollup_id !== this.o.rollupId)
      throw new ExitRefused("cancel is for another chain or rollup");
    if (!accountMatchesKey(body.account, body.public_key))
      throw new ExitRefused("account id does not match the public key");
    if (!verifyExitDocument(body, fromHex(sig), fromHex(body.public_key)))
      throw new ExitRefused("cancel signature invalid");

    const cur = this.get(body.account);
    const seq = BigInt(body.seq);
    const cancelled = cur?.cancelled_seq ? BigInt(cur.cancelled_seq) : -1n;
    const top = seq > cancelled ? seq : cancelled;
    const hit = cur !== undefined && cur.status === "held" && BigInt(cur.seq) <= top;
    this.put({
      account: body.account,
      rollup_id: body.rollup_id,
      seq: cur?.seq ?? body.seq,
      release_height: cur?.release_height ?? "0",
      status: hit ? "cancelled" : (cur?.status ?? "cancelled"),
      packet: hit ? null : (cur?.packet ?? null),
      reason: hit ? "cancelled by the account" : (cur?.reason ?? null),
      cancelled_seq: top.toString(),
      post_tx: cur?.post_tx ?? null,
      attempts: cur?.attempts ?? 0,
      updated_at: this.at(),
    });
    this.o.log({ event: "exit_cancelled", account: body.account, seq: top.toString(), hit });
    return this.view(body.account) as ExitView;
  }

  /**
   * Release every held packet due at `height`. `nonceOf` is the account's
   * nonce after the whole inbox so far (based order: what the next batch sees).
   */
  async tick(height: bigint, nonceOf: (account: Uint8Array) => bigint): Promise<number> {
    const due = this.o.db
      .prepare("SELECT * FROM exits WHERE rollup_id = ? AND status = 'held'")
      .all(this.o.rollupId) as unknown as ExitRow[];
    let posted = 0;
    for (const r of due) {
      if (BigInt(r.release_height) > height) continue;
      const done = (status: ExitStatus, reason: string | null, extra: Partial<ExitRow> = {}) => {
        this.put({ ...r, status, reason, packet: null, updated_at: this.at(), ...extra });
        this.o.log({
          event: `exit_${status}`,
          alert: status === "rejected",
          account: r.account,
          seq: r.seq,
          ...(reason ? { reason } : {}),
          ...(extra.post_tx ? { txhash: extra.post_tx } : {}),
        });
      };
      let opened: ReturnType<typeof openExitPacket>;
      try {
        opened = openExitPacket(ExitPacketV1.parse(JSON.parse(r.packet ?? "")), this.o.kemKeys);
      } catch (err) {
        done("rejected", `could not open: ${(err as Error).message}`);
        continue;
      }
      const nonce = nonceOf(fromHex(r.account));
      if (nonce !== opened.tx.nonce) {
        done("stale", `account nonce is ${nonce}, packet nonce ${opened.tx.nonce}`);
        continue;
      }
      if (!this.o.post) {
        this.o.log({
          event: "exit_due",
          account: r.account,
          seq: r.seq,
          would_post_bytes: opened.data.length,
        });
        continue;
      }
      try {
        const { txhash } = await this.o.post(
          opened.data,
          `exit packet ${r.account.slice(0, 8)} seq ${r.seq}`,
        );
        done("posted", null, { post_tx: txhash, attempts: r.attempts + 1 });
        posted += 1;
      } catch (err) {
        const attempts = r.attempts + 1;
        const last = attempts >= MAX_EXIT_POST_ATTEMPTS;
        this.put({
          ...r,
          attempts,
          reason: String(err),
          status: last ? "rejected" : "held",
          ...(last ? { packet: null } : {}),
          updated_at: this.at(),
        });
        this.o.log({
          event: "exit_post_failed",
          alert: true,
          account: r.account,
          seq: r.seq,
          attempts,
          error: String(err),
        });
      }
    }
    return posted;
  }
}
