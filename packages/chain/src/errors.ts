export type ChainErrorCode = "simulate_failed" | "tx_failed" | "spend_cap" | "http";

/** A chain call failed in a way the caller must handle. */
export class ChainError extends Error {
  override readonly name = "ChainError";
  readonly code: ChainErrorCode;
  readonly detail: unknown;

  constructor(message: string, code: ChainErrorCode, detail?: unknown) {
    super(message);
    this.code = code;
    this.detail = detail;
  }
}
