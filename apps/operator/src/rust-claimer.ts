/**
 * The Rust self-check as a long-lived `sdiqt-prove claim` process: one batch
 * input per line in, one claim per line out, answered in order.
 */
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { createInterface } from "node:readline";
import type { BatchPlan } from "./plan.ts";
import type { RustClaim, RustClaimer } from "./selfcheck.ts";

interface Waiter {
  resolve: (c: RustClaim) => void;
  reject: (e: Error) => void;
}

export class ProcessRustClaimer implements RustClaimer {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly waiting: Waiter[] = [];
  private dead: Error | undefined;

  constructor(binary: string, args: string[] = []) {
    this.child = spawn(binary, ["claim", ...args], { stdio: ["pipe", "pipe", "pipe"] });
    createInterface({ input: this.child.stdout }).on("line", (line) => {
      const w = this.waiting.shift();
      if (!w) return;
      try {
        const reply = JSON.parse(line) as RustClaim & { error?: string };
        if (reply.error !== undefined) w.reject(new Error(reply.error));
        else w.resolve(reply);
      } catch (err) {
        w.reject(err as Error);
      }
    });
    const fail = (err: Error) => {
      this.dead = err;
      for (const w of this.waiting.splice(0)) w.reject(err);
    };
    this.child.on("error", fail);
    this.child.on("exit", (code) => fail(new Error(`sdiqt-prove claim exited with ${code}`)));
  }

  claim(input: BatchPlan["input"]): Promise<RustClaim> {
    if (this.dead) return Promise.reject(this.dead);
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.child.stdin.write(`${JSON.stringify(input)}\n`);
    });
  }

  close(): void {
    this.child.stdin.end();
  }
}
