#!/usr/bin/env node
/**
 * PROOF.md and docs/counts.json, recomputed from the chain and the proof
 * bundles. Every number in README, explorer, video and PROOF.md comes from
 * here.
 *
 *   node scripts/proof.mjs [--archive data/archive/sdiqt-1]
 *                          [--bundles data/prove/sdiqt-1/bundles | https://sdiqt.xyz/bundles]
 *                          [--at-height N | tip] [--check]
 *
 * Sources: the batch and inbox archive (it outlives the chain's pruning of
 * batch records), the chain's tx index for tx heights and times, the chain's
 * batch records for rejections, and each proof bundle, verified here with the
 * same wasm verifier the explorer uses.
 *
 * The output is a snapshot at one chain height (default: the archive head;
 * `tip` takes the chain's latest block and prints the height to rerun with), so
 * two runs on the same archive give byte-identical files. A batch counts as
 * final when the chain has not rejected it and its challenge window closed
 * before the snapshot block. Verify times are left out: they vary per run.
 * `--check` writes nothing and fails when either file would change.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { readArchive } from "../apps/archiver/src/index.ts";
import { createChainClient } from "../packages/chain/src/index.ts";
import {
  BundleManifestV1,
  CHAIN_ID,
  CHAIN_REST_URL,
  CountsV1,
  decodeQstrV1,
  fromHex,
  manifestSha256,
  ROLLUP_ID,
} from "../packages/protocol/src/index.ts";
import { manifestVsBatch, qstrVsManifest, verifyBundle } from "../packages/verify/src/index.ts";

const rdk = createRequire(new URL("../packages/chain/package.json", import.meta.url))(
  "@qorechain/rdk",
);

const ROOT = new URL("..", import.meta.url).pathname;
const QSTR_MAGIC = "51535452";

const { values } = parseArgs({
  options: {
    archive: { type: "string", default: join(ROOT, "data/archive", ROLLUP_ID) },
    bundles: { type: "string", default: join(ROOT, "data/prove", ROLLUP_ID, "bundles") },
    "at-height": { type: "string" },
    check: { type: "boolean", default: false },
  },
});

// ---------------------------------------------------------------- chain reads

const txCache = new Map();
/** One tx from the chain's index: height, time, code and message types. */
async function tx(hash) {
  if (txCache.has(hash)) return txCache.get(hash);
  const res = await fetch(`${CHAIN_REST_URL}/cosmos/tx/v1beta1/txs/${hash}`);
  if (!res.ok) throw new Error(`tx ${hash}: HTTP ${res.status} (outside the node's tx index?)`);
  const r = (await res.json()).tx_response;
  const out = {
    hash,
    height: BigInt(r.height),
    time: Date.parse(r.timestamp) / 1000,
    code: r.code,
    actions: r.tx.body.messages.map((m) => m["@type"]),
    signers: [
      ...new Set(
        r.tx.body.messages.flatMap((m) =>
          ["sender", "creator", "submitter", "sequencer", "poster", "depositor", "from_address"]
            .map((k) => m[k])
            .filter(Boolean),
        ),
      ),
    ],
  };
  txCache.set(hash, out);
  return out;
}

async function blockTime(height) {
  const res = await fetch(`${CHAIN_REST_URL}/cosmos/base/tendermint/v1beta1/blocks/${height}`);
  if (!res.ok) throw new Error(`block ${height}: HTTP ${res.status}`);
  const t = (await res.json()).block.header.time;
  return Math.floor(Date.parse(t) / 1000);
}

// ---------------------------------------------------------------- bundles

async function readBundle(name) {
  const base = values.bundles.replace(/\/$/, "");
  const remote = /^https?:\/\//.test(base);
  const get = async (file) => {
    if (!remote) return readFile(join(base, name, file));
    const res = await fetch(`${base}/${name}/${file}`);
    if (!res.ok) throw new Error(`${base}/${name}/${file}: HTTP ${res.status}`);
    return new Uint8Array(await res.arrayBuffer());
  };
  let manifestText;
  try {
    manifestText = new TextDecoder().decode(await get("manifest.json"));
  } catch {
    return undefined;
  }
  const manifest = BundleManifestV1.parse(JSON.parse(manifestText));
  const proofs = [];
  for (const c of manifest.chunks) proofs.push(new Uint8Array(await get(c.file)));
  return { manifestText, manifest, proofs };
}

// ---------------------------------------------------------------- snapshot

const claimsDoc = JSON.parse(await readFile(join(ROOT, "docs/claims.json"), "utf8"));
const operator = claimsDoc.accounts.operator;
const { entries, batches } = await readArchive(values.archive);
if (batches.length === 0) throw new Error(`no batches in ${values.archive}`);

const archiveHead = [...entries, ...batches].reduce(
  (m, r) => (BigInt(r.height) > m ? BigInt(r.height) : m),
  0n,
);
const client = createChainClient();
const atArg = values["at-height"];
const atHeight =
  atArg === "tip"
    ? BigInt(await client.rest.getLatestHeight())
    : atArg
      ? BigInt(atArg)
      : archiveHead;
const atTime = await blockTime(atHeight);
const windowSec = Number((await client.rest.getRollup(ROLLUP_ID)).challengeWindowSec ?? 3600);

const inSnap = (r) => BigInt(r.height) <= atHeight;
const snapEntries = entries.filter(inSnap);
const snapBatches = batches.filter(inSnap);

const isOwnQstr = (e) => e.poster === operator && e.payload.startsWith(QSTR_MAGIC);

/** Every QSTR the operator posted, by batch index (later posts win). */
const qstrs = new Map();
for (const e of snapEntries.filter(isOwnQstr)) {
  try {
    const q = decodeQstrV1(fromHex(e.payload));
    if (q.rollupId === ROLLUP_ID && q.chainId === CHAIN_ID)
      qstrs.set(q.batchIndex, { q, entry: e });
  } catch {
    // A malformed commitment proves nothing; the batch stays unproven.
  }
}

function userEntry(e) {
  if (e.kind === "deposit") {
    const d = rdk.decodeQledgerDeposit(e.payload);
    return { type: "deposit", amount: d?.amount ?? 0n, by: e.poster.replace(/^deposit:/, "") };
  }
  const t = rdk.decodeQledgerTx(e.payload);
  if (!t) return { type: "other", amount: 0n, by: e.poster };
  return { type: t.to ? "transfer" : "withdrawal", amount: t.amount, by: e.poster };
}

// Index reuse means an upheld challenge rolled the earlier submission back.
const lastByIndex = new Map();
for (const b of snapBatches) lastByIndex.set(b.batch_index, b.txhash);

const rows = [];
for (const b of snapBatches) {
  const superseded = lastByIndex.get(b.batch_index) !== b.txhash;
  const submit = await tx(b.txhash);
  const slice = snapEntries.filter(
    (e) => BigInt(e.sequence) > BigInt(b.inbox_start) && BigInt(e.sequence) <= BigInt(b.inbox_end),
  );
  const users = slice.filter((e) => !isOwnQstr(e)).map(userEntry);

  let chainStatus = "unknown";
  try {
    chainStatus = (await client.rest.getBatch(ROLLUP_ID, BigInt(b.batch_index))).status;
  } catch (err) {
    if (!rdk.isRestNotFound(err)) throw err;
    chainStatus = "pruned";
  }
  const rejected = superseded || chainStatus === "rejected";
  const settlement = rejected
    ? "rejected"
    : submit.time + windowSec <= atTime
      ? "final"
      : "pending";

  const posted = superseded ? undefined : qstrs.get(b.batch_index);
  let validity = "unproven";
  let proof;
  if (posted) {
    const name = `batch-${b.batch_index}-${b.txhash.slice(0, 12)}`;
    const bundle = await readBundle(name);
    if (bundle) {
      const sha = manifestSha256(bundle.manifest);
      const verdict = verifyBundle(
        bundle.manifestText,
        bundle.proofs,
        bundle.manifest.program_vkey_hash,
      );
      const differs = [
        ...manifestVsBatch(bundle.manifest, b),
        ...qstrVsManifest(posted.q, bundle.manifest),
      ];
      const qstrTx = await tx(posted.entry.txhash);
      proof = {
        bundle: name,
        manifest_sha256: sha,
        chunks: bundle.manifest.chunks.length,
        sig_mode: bundle.manifest.sig_mode,
        program_vkey_hash: bundle.manifest.program_vkey_hash,
        qstr_tx: posted.entry.txhash,
        qstr_height: qstrTx.height.toString(),
        latency_s: Math.round(qstrTx.time - submit.time),
        valid: verdict.valid,
        differs,
      };
      if (verdict.valid && differs.length === 0) validity = "proven";
      else validity = "mismatch";
    }
  }

  rows.push({
    batch_index: b.batch_index,
    submit_tx: b.txhash,
    submit_height: b.height,
    submitter: b.sequencer,
    inbox: `${b.inbox_start}..${b.inbox_end}`,
    entries: slice.length,
    user_entries: users,
    settlement,
    validity,
    proof,
  });
}

// ---------------------------------------------------------------- claims

const claimRows = [];
for (const c of claimsDoc.claims) {
  const t = await tx(c.tx);
  const signer = claimsDoc.accounts[c.signer];
  const ok = t.code === 0 && t.actions.includes(c.action) && t.signers.includes(signer);
  claimRows.push({ ...c, height: t.height.toString(), ok, signer_address: signer });
}

// ---------------------------------------------------------------- counts

const median = (xs) => {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const live = rows.filter((r) => r.settlement !== "rejected");
const proven = live.filter((r) => r.validity === "proven");
const latencies = proven.map((r) => r.proof.latency_s);
const small = proven.filter((r) => r.user_entries.length <= 4).map((r) => r.proof.latency_s);
const users = rows.filter((r) => r.settlement !== "rejected").flatMap((r) => r.user_entries);
const latest = rows.at(-1);

const counts = CountsV1.parse({
  version: 1,
  chain_id: CHAIN_ID,
  rollup_id: ROLLUP_ID,
  snapshot_height: atHeight.toString(),
  snapshot_time: new Date(atTime * 1000).toISOString(),
  challenge_window_s: windowSec,
  batches: rows.length,
  batches_live: live.length,
  batches_proven: proven.length,
  batches_final: live.filter((r) => r.settlement === "final").length,
  batches_pending: live.filter((r) => r.settlement === "pending").length,
  batches_rejected: rows.length - live.length,
  batches_unproven: live.filter((r) => r.validity === "unproven").length,
  batches_mismatch: live.filter((r) => r.validity === "mismatch").length,
  qstr_posts: snapEntries.filter(isOwnQstr).length,
  user_entries: users.length,
  deposits: users.filter((u) => u.type === "deposit").length,
  transfers: users.filter((u) => u.type === "transfer").length,
  withdrawals: users.filter((u) => u.type === "withdrawal").length,
  proof_latency_s: {
    median: median(latencies),
    max: latencies.length ? Math.max(...latencies) : null,
    max_small_batches: small.length ? Math.max(...small) : null,
  },
  latest_batch: latest
    ? { index: latest.batch_index, settlement: latest.settlement, validity: latest.validity }
    : null,
  claims_checked: claimRows.length,
  claims_ok: claimRows.filter((c) => c.ok).length,
});

// ---------------------------------------------------------------- PROOF.md

const short = (h) => `${h.slice(0, 10)}…`;
const qor = (uqor) => {
  const v = BigInt(uqor);
  const frac = (v % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return `${v / 1_000_000n}${frac ? `.${frac}` : ""} QOR`;
};
const dur = (s) =>
  s == null ? "n/a" : s < 120 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;

const md = [];
md.push("# PROOF");
md.push("");
md.push(
  `Every claim below names a QoreChain \`${CHAIN_ID}\` transaction or a file in this repository. ` +
    `Generated by \`node scripts/proof.mjs\` at chain height ${atHeight} (${counts.snapshot_time}); ` +
    "a rerun on the same archive gives this file byte for byte. The numbers also live in " +
    "[`docs/counts.json`](docs/counts.json).",
);
md.push("");
md.push("## Numbers");
md.push("");
md.push("| Count | Value |");
md.push("|---|---|");
md.push(`| Batches submitted to \`${ROLLUP_ID}\` | ${counts.batches} |`);
md.push(
  `| Batches proven (bundle VALID, roots equal the chain, QSTR posted) | ${counts.batches_proven} |`,
);
md.push(
  `| Batches final (challenge window of ${windowSec} s closed, not rejected) | ${counts.batches_final} |`,
);
md.push(`| Batches rejected by a challenge | ${counts.batches_rejected} |`);
md.push(
  `| User entries (deposits / transfers / withdrawals) | ${counts.user_entries} (${counts.deposits} / ${counts.transfers} / ${counts.withdrawals}) |`,
);
md.push(`| QSTR commitments posted | ${counts.qstr_posts} |`);
md.push(`| Median time from batch submit to QSTR post | ${dur(counts.proof_latency_s.median)} |`);
md.push(`| Longest time from batch submit to QSTR post | ${dur(counts.proof_latency_s.max)} |`);
md.push("");
md.push("## Setup on chain");
md.push("");
md.push("| Claim | Tx | Height | Checked |");
md.push("|---|---|---|---|");
for (const c of claimRows) {
  md.push(
    `| ${c.claim} | \`${c.tx}\` | ${c.height} | ${c.ok ? "code 0, signer and message match" : "**FAILED**"} |`,
  );
}
md.push("");
md.push("## Batches");
md.push("");
md.push(
  "Proof latency is the chain time between the batch submit tx and the QSTR post that commits to its bundle.",
);
md.push("");
md.push(
  "| Batch | Submit tx | Inbox | User entries | Settlement | Validity | QSTR tx | Bundle manifest SHA-256 | Latency |",
);
md.push("|---|---|---|---|---|---|---|---|---|");
for (const r of rows) {
  const p = r.proof;
  md.push(
    `| ${r.batch_index} | \`${short(r.submit_tx)}\` | ${r.inbox} | ${r.user_entries.length} | ${r.settlement} | ${r.validity} | ` +
      `${p ? `\`${short(p.qstr_tx)}\`` : "none"} | ${p ? `\`${short(p.manifest_sha256)}\`` : "none"} | ${p ? dur(p.latency_s) : "n/a"} |`,
  );
}
md.push("");
md.push("<details><summary>Full hashes</summary>");
md.push("");
for (const r of rows) {
  md.push(`- Batch ${r.batch_index}: submit \`${r.submit_tx}\` (height ${r.submit_height})`);
  if (r.proof) {
    md.push(`  - QSTR \`${r.proof.qstr_tx}\` (height ${r.proof.qstr_height})`);
    md.push(
      `  - bundle \`${r.proof.bundle}\`, manifest SHA-256 \`${r.proof.manifest_sha256}\`, ${r.proof.chunks} chunk(s), sig mode ${r.proof.sig_mode}`,
    );
  }
}
md.push("");
md.push("</details>");
md.push("");
md.push("## User entries");
md.push("");
md.push(
  "Every entry is in the rollup inbox; transfers and withdrawals carry an ML-DSA-44 signature checked inside the proof.",
);
md.push("");
md.push("| Batch | Type | Amount | Posted by |");
md.push("|---|---|---|---|");
for (const r of rows) {
  for (const u of r.user_entries)
    md.push(`| ${r.batch_index} | ${u.type} | ${qor(u.amount)} | \`${u.by}\` |`);
}
md.push("");
md.push("## Not shown yet");
md.push("");
for (const o of claimsDoc.open) md.push(`- **${o.requirement}:** ${o.plan}.`);
md.push("");
const createdHeight = claimRows.find((c) => c.id === "rollup-created")?.height;
if (!createdHeight) throw new Error("docs/claims.json needs the rollup-created claim");
md.push("## Check it yourself");
md.push("");
md.push("```bash");
md.push("pnpm install --frozen-lockfile");
md.push(`node apps/archiver/src/cli.ts --rollup ${ROLLUP_ID} --from-height ${createdHeight}`);
md.push(
  `node scripts/proof.mjs --bundles https://sdiqt.xyz/bundles --at-height ${atHeight} --check`,
);
md.push("```");
md.push("");
md.push(
  "The archive is the operator's copy of every inbox entry and batch (`sdiqt-archive`); the watchtower keeps its own and serves the same rows at https://sdiqt.xyz/api/batches.",
);
md.push("");

const outputs = [
  [join(ROOT, "docs/counts.json"), `${JSON.stringify(counts, null, 2)}\n`],
  [join(ROOT, "PROOF.md"), md.join("\n")],
];

let changed = 0;
for (const [file, text] of outputs) {
  const before = await readFile(file, "utf8").catch(() => "");
  if (before === text) continue;
  changed += 1;
  if (values.check) console.error(`${file} would change`);
  else await writeFile(file, text);
}
console.log(
  JSON.stringify({
    snapshot_height: counts.snapshot_height,
    batches: counts.batches,
    proven: counts.batches_proven,
    final: counts.batches_final,
    claims_ok: `${counts.claims_ok}/${counts.claims_checked}`,
    changed,
  }),
);
if (values.check && changed > 0) process.exit(1);
if (claimRows.some((c) => !c.ok)) process.exit(1);
