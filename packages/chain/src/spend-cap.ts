/**
 * A daily (UTC) ceiling on uqor spent by one key: fees plus amounts sent.
 * A spend is reserved before broadcast and released if the transaction is
 * never sent, so concurrent callers cannot overshoot the cap.
 */
import { ChainError } from "./errors.ts";

export interface SpendRecord {
  day: string;
  spentUqor: bigint;
}

export class SpendCap {
  readonly limitUqorPerDay: bigint;
  private readonly now: () => Date;
  private day: string;
  private spent = 0n;

  constructor(limitUqorPerDay: bigint, now: () => Date = () => new Date(), restored?: SpendRecord) {
    this.limitUqorPerDay = limitUqorPerDay;
    this.now = now;
    this.day = this.today();
    if (restored?.day === this.day) this.spent = restored.spentUqor;
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private roll(): void {
    const today = this.today();
    if (today !== this.day) {
      this.day = today;
      this.spent = 0n;
    }
  }

  /** Reserve `uqor`; throws when the day's cap would be exceeded. */
  reserve(uqor: bigint, label: string): void {
    if (uqor < 0n) throw new RangeError("spend must be non-negative");
    this.roll();
    if (this.spent + uqor > this.limitUqorPerDay) {
      throw new ChainError(
        `${label}: spend ${uqor} uqor would exceed the daily cap (${this.spent} of ${this.limitUqorPerDay} used)`,
        "spend_cap",
      );
    }
    this.spent += uqor;
  }

  /** Give back a reservation that was never broadcast. */
  release(uqor: bigint): void {
    this.roll();
    this.spent = this.spent > uqor ? this.spent - uqor : 0n;
  }

  snapshot(): SpendRecord {
    this.roll();
    return { day: this.day, spentUqor: this.spent };
  }
}
