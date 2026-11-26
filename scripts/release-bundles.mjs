#!/usr/bin/env node
/**
 * The proof bundles attached to a GitHub release: every proven batch that
 * PROOF.md lists, downloaded and checked against the hashes this repository
 * records.
 *
 *   node scripts/release-bundles.mjs [--bundles https://sdiqt.xyz/bundles | DIR]
 *                                    [--out DIR]
 *
 * Per bundle: the manifest's canonical SHA-256 equals the one PROOF.md lists
 * (the value its QSTR commits to on chain), the chunk count equals PROOF.md,
 * every chunk's SHA-256 equals its manifest entry and the manifest's proof root
 * matches the chunks. The number of bundles equals `batches_proven` in
 * docs/counts.json.
 *
 * With `--out` the bundles are written as `<out>/<bundle>/manifest.json` and
 * `<out>/<bundle>/chunk-N.bin`, byte for byte as served, plus
 * `<out>/SHA256SUMS`. Without it the script downloads and checks only.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { BundleManifestV1, manifestSha256, proofRoot } from "../packages/protocol/src/index.ts";

const ROOT = new URL("..", import.meta.url).pathname;
const BUNDLE_LINE =
  /^\s*- bundle `(batch-[0-9]+-[0-9A-F]{12})`, manifest SHA-256 `([0-9a-f]{64})`, ([0-9]+) chunk\(s\)/;

const { values } = parseArgs({
  options: {
    bundles: { type: "string", default: "https://sdiqt.xyz/bundles" },
    out: { type: "string" },
  },
});

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/** Bundle name, manifest SHA-256 and chunk count for every proven batch in PROOF.md. */
async function listedBundles() {
  const proof = await readFile(join(ROOT, "PROOF.md"), "utf8");
  const counts = JSON.parse(await readFile(join(ROOT, "docs/counts.json"), "utf8"));
  const listed = [];
  for (const line of proof.split("\n")) {
    const m = BUNDLE_LINE.exec(line);
    if (m) listed.push({ name: m[1], manifestSha256: m[2], chunks: Number(m[3]) });
  }
  if (listed.length !== counts.batches_proven) {
    throw new Error(
      `PROOF.md lists ${listed.length} bundle(s), docs/counts.json has ${counts.batches_proven} proven batch(es)`,
    );
  }
  if (new Set(listed.map((b) => b.name)).size !== listed.length) {
    throw new Error("PROOF.md lists a bundle twice");
  }
  return listed;
}

async function fetchFile(name, file) {
  const base = values.bundles.replace(/\/$/, "");
  if (!/^https?:\/\//.test(base)) return new Uint8Array(await readFile(join(base, name, file)));
  const res = await fetch(`${base}/${name}/${file}`);
  if (!res.ok) throw new Error(`${base}/${name}/${file}: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

/** Downloads one bundle and checks it; returns its files as [relative path, bytes]. */
async function collect(entry) {
  const manifestBytes = await fetchFile(entry.name, "manifest.json");
  const manifest = BundleManifestV1.parse(JSON.parse(new TextDecoder().decode(manifestBytes)));
  const problems = [];
  const sha = manifestSha256(manifest);
  if (sha !== entry.manifestSha256) {
    problems.push(`manifest SHA-256 ${sha}, PROOF.md lists ${entry.manifestSha256}`);
  }
  if (manifest.chunks.length !== entry.chunks) {
    problems.push(`${manifest.chunks.length} chunk(s), PROOF.md lists ${entry.chunks}`);
  }
  const root = proofRoot(manifest.chunks.map((c) => c.proof_sha256));
  if (root !== manifest.proof_root) {
    problems.push(`proof root ${root}, manifest has ${manifest.proof_root}`);
  }
  const files = [[`${entry.name}/manifest.json`, manifestBytes]];
  for (const chunk of manifest.chunks) {
    const bytes = await fetchFile(entry.name, chunk.file);
    const got = sha256(bytes);
    if (got !== chunk.proof_sha256) {
      problems.push(`${chunk.file} SHA-256 ${got}, manifest has ${chunk.proof_sha256}`);
    }
    files.push([`${entry.name}/${chunk.file}`, bytes]);
  }
  if (problems.length > 0) throw new Error(`${entry.name}: ${problems.join("; ")}`);
  return files;
}

const listed = await listedBundles();
const files = [];
for (const entry of listed) {
  const bundleFiles = await collect(entry);
  files.push(...bundleFiles);
  const size = bundleFiles.reduce((n, [, b]) => n + b.length, 0);
  console.log(`${entry.name}: ok, ${bundleFiles.length} file(s), ${size} bytes`);
}

if (values.out) {
  const sums = [];
  for (const [path, bytes] of files) {
    await mkdir(join(values.out, path, ".."), { recursive: true });
    await writeFile(join(values.out, path), bytes);
    sums.push(`${sha256(bytes)}  ${path}`);
  }
  await writeFile(join(values.out, "SHA256SUMS"), `${sums.join("\n")}\n`);
}
console.log(
  JSON.stringify({ bundles: listed.length, files: files.length, written: values.out ?? null }),
);
