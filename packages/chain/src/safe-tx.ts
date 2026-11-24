/**
 * Simulate-first transactions: every message is simulated before it is
 * signed, a failed simulation stops the send, and the fee plus any amount
 * moved is reserved against the daily spend cap.
 */
import type { EncodeObject } from "@cosmjs/proto-signing";
import type { DeliverTxResponse } from "@cosmjs/stargate";
import { ChainError } from "./errors.ts";
import type { SpendCap } from "./spend-cap.ts";

/** Gas headroom over the simulated amount, as RDK's "auto" fee uses. */
export const GAS_ADJUSTMENT_PERCENT = 130n;

export interface Simulator {
  simulate(messages: readonly EncodeObject[], memo?: string): Promise<number>;
}

export interface SafeTxOptions {
  /** uqor per gas unit, scaled by `gasPriceScale` (0.15 uqor = 15 / 100). */
  gasPriceNumerator: bigint;
  gasPriceScale: bigint;
  cap: SpendCap;
}

export interface SafeSend {
  label: string;
  messages: readonly EncodeObject[];
  /** uqor the messages move out of the account besides the fee. */
  amountUqor?: bigint;
  /** Broadcast the same messages (usually an RdkTxClient method). */
  send: () => Promise<DeliverTxResponse>;
}

export function feeForGas(
  gas: bigint,
  opts: Pick<SafeTxOptions, "gasPriceNumerator" | "gasPriceScale">,
): bigint {
  const adjusted = (gas * GAS_ADJUSTMENT_PERCENT + 99n) / 100n;
  return (adjusted * opts.gasPriceNumerator + opts.gasPriceScale - 1n) / opts.gasPriceScale;
}

/** Parse a gas price such as "0.15uqor" into an exact fraction. */
export function parseGasPrice(
  price: string,
): Pick<SafeTxOptions, "gasPriceNumerator" | "gasPriceScale"> {
  const m = /^([0-9]+)(?:\.([0-9]+))?uqor$/.exec(price);
  if (!m) throw new RangeError(`gas price ${price}: expected <decimal>uqor`);
  const frac = m[2] ?? "";
  return { gasPriceNumerator: BigInt(`${m[1]}${frac}`), gasPriceScale: 10n ** BigInt(frac.length) };
}

export class SafeTx {
  private readonly simulator: Simulator;
  private readonly opts: SafeTxOptions;

  constructor(simulator: Simulator, opts: SafeTxOptions) {
    this.simulator = simulator;
    this.opts = opts;
  }

  /** Simulate, reserve, broadcast; returns the delivered tx or throws. */
  async run({
    label,
    messages,
    amountUqor = 0n,
    send,
  }: SafeSend): Promise<{ tx: DeliverTxResponse; gas: bigint; feeUqor: bigint }> {
    let gas: bigint;
    try {
      gas = BigInt(await this.simulator.simulate(messages));
    } catch (err) {
      throw new ChainError(
        `${label}: simulation failed: ${(err as Error).message}`,
        "simulate_failed",
        err,
      );
    }
    const feeUqor = feeForGas(gas, this.opts);
    const reserved = feeUqor + amountUqor;
    this.opts.cap.reserve(reserved, label);

    let tx: DeliverTxResponse;
    try {
      tx = await send();
    } catch (err) {
      this.opts.cap.release(reserved);
      throw new ChainError(
        `${label}: broadcast failed: ${(err as Error).message}`,
        "tx_failed",
        err,
      );
    }
    if (tx.code !== 0) {
      throw new ChainError(
        `${label}: tx ${tx.transactionHash} failed with code ${tx.code}: ${tx.rawLog ?? ""}`,
        "tx_failed",
        tx,
      );
    }
    return { tx, gas, feeUqor };
  }
}
