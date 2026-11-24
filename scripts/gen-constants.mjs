#!/usr/bin/env node
// Generate protocol constants for TypeScript and Rust from config/constants.json.
//   node scripts/gen-constants.mjs          write the generated files
//   node scripts/gen-constants.mjs --check  fail if a generated file is stale

import { readFileSync, writeFileSync } from "node:fs";

const SOURCE = "config/constants.json";
const TS_OUT = "packages/protocol/src/constants.ts";
const RS_OUT = "crates/sdiqt-statement/src/constants.rs";
const HEADER = `Generated from ${SOURCE} by scripts/gen-constants.mjs. Do not edit.`;

const config = JSON.parse(readFileSync(SOURCE, "utf8"));
const isInteger = (v) => /^(0|[1-9][0-9]*)$/.test(v);
const upper = (...parts) => parts.join("_").toUpperCase();

const items = Object.entries(config).flatMap(([group, values]) =>
  Object.entries(values).map(([key, value]) => {
    if (typeof value !== "string") throw new Error(`${group}.${key}: values must be strings`);
    return { name: upper(group, key), value, integer: isInteger(value) && !/(^|_)id$/.test(key) };
  }),
);

const ts = [
  `// ${HEADER}`,
  "",
  ...items.map(({ name, value, integer }) =>
    integer
      ? `export const ${name} = ${value}n;`
      : `export const ${name} = ${JSON.stringify(value)};`,
  ),
  "",
].join("\n");

const rs = [
  `//! ${HEADER}`,
  "",
  ...items.map(({ name, value, integer }) =>
    integer
      ? `pub const ${name}: u64 = ${Number(value).toLocaleString("en-US").replaceAll(",", "_")};`
      : `pub const ${name}: &str = ${JSON.stringify(value)};`,
  ),
  "",
].join("\n");

const outputs = [
  [TS_OUT, ts],
  [RS_OUT, rs],
];

if (process.argv[2] === "--check") {
  const stale = outputs.filter(([path, text]) => {
    try {
      return readFileSync(path, "utf8") !== text;
    } catch {
      return true;
    }
  });
  for (const [path] of stale) console.error(`${path} is stale: run node scripts/gen-constants.mjs`);
  process.exit(stale.length ? 1 : 0);
}
for (const [path, text] of outputs) writeFileSync(path, text);
console.log(`wrote ${outputs.map(([p]) => p).join(", ")}`);
