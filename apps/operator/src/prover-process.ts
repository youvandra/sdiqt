/**
 * `ProverRunner` over the release binaries `sdiqt-prove` and `sdiqt-verify`.
 * Every line they print is appended to one log file, so a slow or failed
 * proof can be read back afterwards.
 */
import { spawn } from "node:child_process";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PROVER_CHUNK_MAX_SIGNED_ENTRIES } from "@sdiqt/protocol";
import type { ProverRunner } from "./prove-queue.ts";

export interface ProcessProverOptions {
  prove: string;
  verify: string;
  /** Archive directory of the rollup (its name is the rollup id). */
  archiveDir: string;
  chainId: string;
  logFile: string;
  /** `full` (ML-DSA-44 inside the proof) or `v0`. */
  mode?: "full" | "v0";
}

async function run(bin: string, args: string[], logFile: string): Promise<string> {
  await mkdir(dirname(logFile), { recursive: true });
  await appendFile(logFile, `$ ${bin} ${args.join(" ")}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      void appendFile(logFile, d);
    });
    child.stderr.on("data", (d: Buffer) => void appendFile(logFile, d));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(out);
      else
        reject(
          new Error(
            `${bin} ${args[0]} exited with ${code}: ${out.trim().split("\n").at(-1) ?? ""}`,
          ),
        );
    });
  });
}

export function processProver(o: ProcessProverOptions): ProverRunner {
  const chunk = [
    "--chunk-size",
    PROVER_CHUNK_MAX_SIGNED_ENTRIES.toString(),
    "--mode",
    o.mode ?? "full",
  ];
  return {
    async buildInput(txhash, outDir) {
      const out = await run(
        o.prove,
        [
          "from-archive",
          o.archiveDir,
          "--batch-tx",
          txhash,
          "--out",
          outDir,
          "--chain-id",
          o.chainId,
          ...chunk,
        ],
        o.logFile,
      );
      const line = out.split("\n").find((l) => l.startsWith("batch "));
      const m = line && /^batch ([0-9]+) tx ([0-9A-F]+) .*: (MATCH|DIFFERS)$/.exec(line);
      if (!m) throw new Error(`sdiqt-prove from-archive printed no verdict for ${txhash}`);
      const report = out
        .slice(out.indexOf(line))
        .split("\n")
        .filter((l) => l.startsWith("  ") || l === line)
        .join("\n");
      return {
        input: join(outDir, `batch-${m[1]}-${(m[2] as string).slice(0, 12)}.json`),
        matches: m[3] === "MATCH",
        report,
      };
    },
    async prove(input, bundleDir) {
      await run(o.prove, ["prove", input, "--out", bundleDir, ...chunk], o.logFile);
    },
    async verify(bundleDir) {
      const out = await run(o.verify, ["bundle", bundleDir], o.logFile);
      if (!/^VALID/m.test(out))
        throw new Error(`sdiqt-verify did not print VALID for ${bundleDir}`);
    },
  };
}
