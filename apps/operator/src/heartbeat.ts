/**
 * Heartbeat: one small signed qledger transfer per interval between two L2
 * accounts, alternating direction, so the based inbox keeps receiving entries
 * and the operator keeps cutting (and proving) batches.
 *
 * The sender's nonce comes from replaying the archived inbox. One post is in
 * flight at a time: the next tick waits until the archive shows the previous
 * post executed, and the run stops when it never shows. The run also stops on
 * the total fee cap, the tick limit, the stop file, a failed transaction or an
 * empty sender. Simulate mode never broadcasts; it applies each would-be post
 * to a local overlay so later ticks show the nonces they would use.
 */

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export interface HeartbeatAccount {
  name: string;
  id: Uint8Array;
}

export interface LedgerView {
  get(id: Uint8Array): { balance: bigint; nonce: bigint };
}

export interface HeartbeatPost {
  tick: number;
  from: HeartbeatAccount;
  to: HeartbeatAccount;
  nonce: bigint;
  amountUqor: bigint;
}

export interface HeartbeatChain {
  /** The ledger after the last archived inbox entry. */
  readLedger(): Promise<{ head: bigint; ledger: LedgerView }>;
  simulate(post: HeartbeatPost): Promise<{ gas: bigint; feeUqor: bigint; bytes: number }>;
  broadcast(post: HeartbeatPost): Promise<{
    hash: string;
    code: number;
    height?: number | undefined;
    feeUqor: bigint;
  }>;
}

export interface HeartbeatConfig {
  /** `pair[0]` sends first; the direction flips after every post. */
  pair: [HeartbeatAccount, HeartbeatAccount];
  amountUqor: bigint;
  intervalMs: number;
  /** How often to re-read the archive while waiting for the previous post. */
  pollMs: number;
  /** Stop when the previous post has not shown up in the archive after this long. */
  maxWaitMs: number;
  maxTicks: number;
  /** Total fee budget for the run, in uqor. */
  capUqor: bigint;
  /** Stop after this many consecutive read or simulate errors. */
  maxErrors: number;
  send: boolean;
}

export interface HeartbeatEnv {
  sleep(ms: number): Promise<void>;
  stopRequested(): boolean;
  log(event: Record<string, unknown>): void;
}

export type StopReason =
  | "max_ticks"
  | "stop_file"
  | "cap"
  | "balance"
  | "lost_post"
  | "tx_failed"
  | "errors";

export interface HeartbeatState {
  ticks: number;
  spentUqor: bigint;
  /** Index into `pair` of the next sender. */
  direction: 0 | 1;
  /** The last broadcast post, until the archive shows it executed. */
  pending?: { from: string; nonce: bigint } | undefined;
  waitedMs: number;
  /** Simulate mode: account state after the would-be posts. */
  overlay: Map<string, { balance: bigint; nonce: bigint }>;
}

export const newHeartbeatState = (): HeartbeatState => ({
  ticks: 0,
  spentUqor: 0n,
  direction: 0,
  waitedMs: 0,
  overlay: new Map(),
});

export type TickDecision =
  | { kind: "post"; post: HeartbeatPost }
  | { kind: "wait"; reason: "archive_lag"; nonce: bigint; pendingNonce: bigint }
  | { kind: "stop"; reason: StopReason; detail?: string };

function account(state: HeartbeatState, ledger: LedgerView, id: Uint8Array) {
  return state.overlay.get(hex(id)) ?? ledger.get(id);
}

/** What the next tick does, given the replayed ledger. Pure. */
export function decideTick(
  state: HeartbeatState,
  ledger: LedgerView,
  cfg: HeartbeatConfig,
): TickDecision {
  if (state.ticks >= cfg.maxTicks) return { kind: "stop", reason: "max_ticks" };
  if (state.pending) {
    const pid = cfg.pair.find((a) => hex(a.id) === state.pending?.from);
    const seen = pid ? ledger.get(pid.id).nonce : 0n;
    if (seen <= state.pending.nonce) {
      if (state.waitedMs >= cfg.maxWaitMs) {
        return {
          kind: "stop",
          reason: "lost_post",
          detail: `nonce ${state.pending.nonce} of ${state.pending.from} not executed after ${cfg.maxWaitMs} ms`,
        };
      }
      return {
        kind: "wait",
        reason: "archive_lag",
        nonce: seen,
        pendingNonce: state.pending.nonce,
      };
    }
  }
  const from = cfg.pair[state.direction];
  const to = cfg.pair[state.direction === 0 ? 1 : 0];
  const sender = account(state, ledger, from.id);
  if (sender.balance < cfg.amountUqor) {
    return {
      kind: "stop",
      reason: "balance",
      detail: `${from.name} holds ${sender.balance} uqor, ${cfg.amountUqor} needed`,
    };
  }
  return {
    kind: "post",
    post: { tick: state.ticks + 1, from, to, nonce: sender.nonce, amountUqor: cfg.amountUqor },
  };
}

/** The fee the cap reserves for a simulated fee: 10% headroom for re-simulation drift. */
export const reservedFee = (simFeeUqor: bigint): bigint => (simFeeUqor * 110n + 99n) / 100n;

export function withinCap(state: HeartbeatState, simFeeUqor: bigint, capUqor: bigint): boolean {
  return state.spentUqor + reservedFee(simFeeUqor) <= capUqor;
}

/** Record a post: flip the direction and track it (pending when sent, overlay when simulated). */
export function recordPost(
  state: HeartbeatState,
  ledger: LedgerView,
  post: HeartbeatPost,
  feeUqor: bigint,
  sent: boolean,
): void {
  state.ticks += 1;
  state.spentUqor += feeUqor;
  state.direction = state.direction === 0 ? 1 : 0;
  state.waitedMs = 0;
  if (sent) {
    state.pending = { from: hex(post.from.id), nonce: post.nonce };
    return;
  }
  const from = account(state, ledger, post.from.id);
  const to = account(state, ledger, post.to.id);
  state.overlay.set(hex(post.from.id), {
    balance: from.balance - post.amountUqor,
    nonce: from.nonce + 1n,
  });
  state.overlay.set(hex(post.to.id), { balance: to.balance + post.amountUqor, nonce: to.nonce });
}

const UQOR = 1_000_000n;
export const formatQor = (uqor: bigint) =>
  `${uqor / UQOR}.${(uqor % UQOR).toString().padStart(6, "0")}`;

/** Sleep `ms` in slices so a stop request ends the wait early. Returns false when stopped. */
async function pause(env: HeartbeatEnv, ms: number): Promise<boolean> {
  let left = ms;
  while (left > 0) {
    if (env.stopRequested()) return false;
    const slice = Math.min(left, 1000);
    await env.sleep(slice);
    left -= slice;
  }
  return !env.stopRequested();
}

export async function runHeartbeat(
  cfg: HeartbeatConfig,
  chain: HeartbeatChain,
  env: HeartbeatEnv,
  state: HeartbeatState = newHeartbeatState(),
): Promise<{ reason: StopReason; state: HeartbeatState }> {
  const mode = cfg.send ? "send" : "simulate";
  let errors = 0;
  const stop = (reason: StopReason, detail?: string) => {
    env.log({
      event: "stop",
      mode,
      reason,
      ...(detail ? { detail } : {}),
      ticks: state.ticks,
      spent_qor: formatQor(state.spentUqor),
      cap_qor: formatQor(cfg.capUqor),
    });
    return { reason, state };
  };
  const failed = (stage: string, e: unknown) => {
    errors += 1;
    env.log({ event: "error", mode, stage, error: String(e), consecutive: errors });
    return errors >= cfg.maxErrors;
  };

  for (;;) {
    if (env.stopRequested()) return stop("stop_file");
    let read: Awaited<ReturnType<HeartbeatChain["readLedger"]>>;
    try {
      read = await chain.readLedger();
    } catch (e) {
      if (failed("read", e)) return stop("errors");
      if (!(await pause(env, cfg.pollMs))) return stop("stop_file");
      continue;
    }
    const decision = decideTick(state, read.ledger, cfg);
    if (decision.kind === "stop") return stop(decision.reason, decision.detail);
    if (decision.kind === "wait") {
      env.log({
        event: "wait",
        mode,
        reason: decision.reason,
        archive_head: read.head.toString(),
        archived_nonce: decision.nonce.toString(),
        pending_nonce: decision.pendingNonce.toString(),
        waited_ms: state.waitedMs,
      });
      state.waitedMs += cfg.pollMs;
      if (!(await pause(env, cfg.pollMs))) return stop("stop_file");
      continue;
    }
    state.pending = undefined;

    const { post } = decision;
    let sim: Awaited<ReturnType<HeartbeatChain["simulate"]>>;
    try {
      sim = await chain.simulate(post);
    } catch (e) {
      if (failed("simulate", e)) return stop("errors");
      if (!(await pause(env, cfg.pollMs))) return stop("stop_file");
      continue;
    }
    errors = 0;
    if (!withinCap(state, sim.feeUqor, cfg.capUqor)) {
      return stop(
        "cap",
        `spent ${formatQor(state.spentUqor)} + fee ${formatQor(reservedFee(sim.feeUqor))} is above the cap`,
      );
    }
    const line = {
      mode,
      tick: post.tick,
      from: post.from.name,
      from_id: hex(post.from.id),
      to: post.to.name,
      to_id: hex(post.to.id),
      nonce: post.nonce.toString(),
      amount_uqor: post.amountUqor.toString(),
      bytes: sim.bytes,
      gas: sim.gas.toString(),
      fee_qor: formatQor(sim.feeUqor),
      archive_head: read.head.toString(),
    };
    if (!cfg.send) {
      recordPost(state, read.ledger, post, sim.feeUqor, false);
      env.log({ event: "would_post", ...line, spent_qor: formatQor(state.spentUqor) });
    } else {
      let r: Awaited<ReturnType<HeartbeatChain["broadcast"]>>;
      try {
        r = await chain.broadcast(post);
      } catch (e) {
        // The tx may still land: treat it as in flight (and spent) so the next
        // tick waits for it instead of reusing the nonce.
        recordPost(state, read.ledger, post, reservedFee(sim.feeUqor), true);
        env.log({ event: "error", stage: "broadcast", error: String(e), ...line });
        if (!(await pause(env, cfg.pollMs))) return stop("stop_file");
        continue;
      }
      if (r.code !== 0) {
        state.spentUqor += r.feeUqor;
        env.log({ event: "tx_failed", ...line, hash: r.hash, code: r.code });
        return stop("tx_failed", `tx ${r.hash} code ${r.code}`);
      }
      recordPost(state, read.ledger, post, r.feeUqor, true);
      env.log({
        event: "posted",
        ...line,
        hash: r.hash,
        height: r.height,
        fee_qor: formatQor(r.feeUqor),
        spent_qor: formatQor(state.spentUqor),
      });
    }
    if (state.ticks >= cfg.maxTicks) return stop("max_ticks");
    if (!(await pause(env, cfg.intervalMs))) return stop("stop_file");
  }
}
