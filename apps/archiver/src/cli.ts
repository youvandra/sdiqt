#!/usr/bin/env node
import { join } from "node:path";
import { parseArgs } from "node:util";
import { createChainClient } from "@sdiqt/chain";
import { CHAIN_ID, ROLLUP_ID } from "@sdiqt/protocol";
import { catchUp } from "./archive.ts";

const USAGE = `sdiqt-archive [--rollup <id>] [--out <dir>] [--from-height <n>] [--watch <seconds>]

Writes <out>/<rollup>/inbox.jsonl and batches.jsonl from the chain's tx index.
Defaults: --rollup ${ROLLUP_ID}, --out data/archive.`;

const { values } = parseArgs({
  options: {
    rollup: { type: "string", default: ROLLUP_ID },
    out: { type: "string", default: "data/archive" },
    "from-height": { type: "string" },
    watch: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const client = createChainClient();
const dir = join(values.out, values.rollup);
const fromHeight = values["from-height"] === undefined ? undefined : BigInt(values["from-height"]);

async function once(first: boolean): Promise<void> {
  const run = await catchUp({
    client,
    chainId: CHAIN_ID,
    rollupId: values.rollup,
    dir,
    ...(first && fromHeight !== undefined ? { fromHeight } : {}),
  });
  console.log(JSON.stringify({ at: new Date().toISOString(), dir, ...run }));
}

await once(true);
if (values.watch !== undefined) {
  const ms = Number(values.watch) * 1000;
  if (!Number.isFinite(ms) || ms < 5000) throw new Error("--watch needs at least 5 seconds");
  for (;;) {
    await new Promise((r) => setTimeout(r, ms));
    try {
      await once(false);
    } catch (err) {
      console.error(JSON.stringify({ at: new Date().toISOString(), error: String(err) }));
    }
  }
}
