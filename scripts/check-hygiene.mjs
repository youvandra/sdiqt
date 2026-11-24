#!/usr/bin/env node

// Repository hygiene checks run in CI and from the git hooks.
//
//   node scripts/check-hygiene.mjs                 tracked files: private paths, wording, held identifiers
//   node scripts/check-hygiene.mjs --commits A..B  commit messages in a range: trailers
//   node scripts/check-hygiene.mjs --message FILE  one commit message file (commit-msg hook)

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const PRIVATE_PATHS = [
  /^notes\//,
  /^NEXT\.md$/,
  /(^|\/)CLAUDE\.md$/,
  /(^|\/)AGENTS\.md$/,
  /^\.claude\//,
  /^secrets\//,
  /(^|\/)\.env(\..+)?$/,
];
const ENV_EXAMPLE = /(^|\/)\.env\.example$/;

// Claims the project does not make. Matched case-insensitively in tracked text.
const BANNED_PHRASES = [
  "stark finalized",
  "verified on chain",
  "verified on-chain",
  "zk settlement",
  "fri stark",
  "sha-256 proof",
  "128-bit post-quantum",
  "first stark on qorechain",
  "one proof per batch",
  "trustless browser verification",
  "lets you",
];
const EM_DASH = "—";

// SHA-256 of identifiers held back until a coordinated disclosure date.
const HELD_IDENTIFIER_HASHES = new Set([
  "fea22f7eeb3d556fdba42a6c288f9201274c028ed29ba219422c5dea31bce323",
]);

const AI_TRAILER =
  /^co-authored-by:.*\b(claude|anthropic|copilot|chatgpt|openai|gemini|cursor)\b/im;

const TEXT_EXT = /\.(md|mdx|txt|rs|toml|ts|tsx|js|mjs|cjs|json|ya?ml|html|css|sh)$/i;
const SELF = "scripts/check-hygiene.mjs";
// Normative keywords in specs ("MUST NOT") are allowed by the wording rules; nothing is exempt from the identifier check.
const WORDING_EXEMPT = new Set([SELF]);

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function checkTrackedFiles() {
  const problems = [];
  const files = git(["ls-files", "-z"]).split("\0").filter(Boolean);

  for (const path of files) {
    if (PRIVATE_PATHS.some((re) => re.test(path)) && !ENV_EXAMPLE.test(path)) {
      problems.push(`${path}: private file is tracked`);
      continue;
    }
    if (!TEXT_EXT.test(path)) continue;

    const text = readFileSync(path, "utf8");
    const lines = text.split("\n");

    if (!WORDING_EXEMPT.has(path)) {
      lines.forEach((line, i) => {
        if (line.includes(EM_DASH)) problems.push(`${path}:${i + 1}: em-dash`);
        const lower = line.toLowerCase();
        for (const phrase of BANNED_PHRASES) {
          if (lower.includes(phrase)) problems.push(`${path}:${i + 1}: banned phrase "${phrase}"`);
        }
      });
    }

    const words = new Set(text.match(/[A-Za-z_][A-Za-z0-9_]{5,}/g) ?? []);
    for (const word of words) {
      if (HELD_IDENTIFIER_HASHES.has(sha256(word))) {
        problems.push(`${path}: contains a held identifier`);
      }
    }
  }
  return problems;
}

function checkMessage(label, message) {
  return AI_TRAILER.test(message) ? [`${label}: AI tool co-author trailer`] : [];
}

function checkCommitRange(range) {
  const out = git(["log", "--format=%H%x00%B%x01", range]);
  return out
    .split("\x01")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      const [sha, body = ""] = entry.split("\0");
      return checkMessage(sha.slice(0, 12), body);
    });
}

function main(argv) {
  const [flag, value] = argv;
  let problems;
  if (flag === "--commits" && value) problems = checkCommitRange(value);
  else if (flag === "--message" && value)
    problems = checkMessage("commit message", readFileSync(value, "utf8"));
  else if (flag === undefined) problems = checkTrackedFiles();
  else {
    console.error("usage: check-hygiene.mjs [--commits A..B | --message FILE]");
    return 2;
  }

  for (const p of problems) console.error(p);
  if (problems.length > 0) {
    console.error(`hygiene: ${problems.length} problem(s)`);
    return 1;
  }
  console.log("hygiene: ok");
  return 0;
}

process.exit(main(process.argv.slice(2)));
