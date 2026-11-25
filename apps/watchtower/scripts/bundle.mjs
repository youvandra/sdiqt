/**
 * Bundle the watchtower into one ESM file for the host, plus the Node wasm
 * verifier it loads at runtime. The host runs it with plain `node`: nothing
 * is installed or built there.
 *
 *   node apps/watchtower/scripts/bundle.mjs [outDir]   (default deploy/dist)
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(root, process.argv[2] ?? "deploy/dist");

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "bin"), { recursive: true });

await build({
  input: join(root, "apps/watchtower/src/cli.ts"),
  platform: "node",
  external: [/^node:/],
  output: {
    file: join(out, "bin/sdiqt-watchtower.mjs"),
    format: "esm",
  },
  logLevel: "warn",
});

// @sdiqt/verify loads `../wasm/node/sdiqt_verify.js` relative to its module;
// in the bundle that module is bin/sdiqt-watchtower.mjs.
cpSync(join(root, "packages/verify/wasm/node"), join(out, "wasm/node"), { recursive: true });
console.log(`bundled into ${out}`);
