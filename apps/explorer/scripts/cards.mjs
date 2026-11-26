/**
 * Renders the link-preview image and the 16:9 submission cover from live numbers.
 *
 *   node scripts/cards.mjs [--rollups https://sdiqt.xyz/api/rollups] [--counts ../../docs/counts.json]
 *
 * Writes public/og.png (1200 x 630) and ../../docs/cover.png (1920 x 1080). The
 * sdiqt-1 numbers come from docs/counts.json (scripts/proof.mjs), coverage from
 * /api/rollups, so both images agree with PROOF.md and the explorer.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const ROOT = join(APP, "../..");

const { values } = parseArgs({
  options: {
    rollups: { type: "string", default: "https://sdiqt.xyz/api/rollups" },
    counts: { type: "string", default: join(ROOT, "docs/counts.json") },
  },
});

async function readJson(src) {
  if (/^https?:/.test(src)) {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`${src}: HTTP ${res.status}`);
    return res.json();
  }
  return JSON.parse(await readFile(src, "utf8"));
}

const counts = await readJson(values.counts);
const fleet = await readJson(values.rollups);
const rollups = fleet.rollups;
if (!Array.isArray(rollups) || rollups.length === 0) throw new Error("no rollups in /api/rollups");

const sum = (key) => rollups.reduce((n, r) => n + Number(r[key] ?? 0), 0);
const fmt = (n) => n.toLocaleString("en-US");
const stats = {
  proven: `${counts.batches_proven}/${counts.batches}`,
  rollups: rollups.length,
  batches: fmt(sum("batches")),
  wrong: sum("mismatches_total"),
  rejected: sum("mismatches_rejected"),
};
if (stats.rejected !== stats.wrong) {
  throw new Error(
    `${stats.wrong} mismatches but ${stats.rejected} rejected: fix the cover line first`,
  );
}

const MIME = { png: "image/png", woff2: "font/woff2" };
const assets = {};
for (const p of [
  "fonts/InterVariable.woff2",
  "fonts/JetBrainsMono.woff2",
  "brand/hero.png",
  "brand/noise.png",
]) {
  const bytes = await readFile(join(APP, "public", p));
  assets[p] = `data:${MIME[p.split(".").pop()]};base64,${bytes.toString("base64")}`;
}
const asset = (p) => assets[p];
const mark =
  '<svg viewBox="0 0 20 20" width="30" height="30" aria-hidden="true"><path d="M0 0h5v5H0zM7 0h5v5H7zM0 7.5h5v5H0zM7 7.5h5v5H7zM0 15h5v5H0zM7 15h5v5H7zM17 7l3 3-3 3-3-3z" fill="#fff"/></svg>';

function page(height) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; font-weight: 100 900; src: url("${asset("fonts/InterVariable.woff2")}") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; src: url("${asset("fonts/JetBrainsMono.woff2")}") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: ${height}px; background: #000; color: #fff; overflow: hidden; }
body { font-family: Inter, sans-serif; position: relative; -webkit-font-smoothing: antialiased; }
.hero { position: absolute; inset: -40px -230px -40px auto; width: 1060px; background: url("${asset("brand/hero.png")}") center / cover no-repeat; }
.fade { position: absolute; inset: 0; background: linear-gradient(90deg, #000 38%, rgba(0,0,0,0.6) 58%, rgba(0,0,0,0) 78%); }
.noise { position: absolute; inset: 0; background: url("${asset("brand/noise.png")}"); opacity: 0.18; mix-blend-mode: overlay; }
.frame { position: absolute; inset: 0; padding: 52px 64px; display: flex; flex-direction: column; }
.brand { display: flex; align-items: center; gap: 14px; font-size: 30px; font-weight: 600; letter-spacing: -0.01em; }
.copy { margin-top: auto; max-width: 640px; }
h1 { font-size: 68px; line-height: 1.02; font-weight: 500; letter-spacing: -0.035em; }
.sub { margin-top: 22px; font-size: 23px; line-height: 1.4; color: #c2c2c2; max-width: 600px; }
.stats { margin-top: auto; display: flex; gap: 0; border-top: 1px solid rgba(255,255,255,0.12); padding-top: 24px; }
.stat { padding-right: 36px; margin-right: 36px; border-right: 1px solid rgba(255,255,255,0.12); }
.stat:last-child { border-right: 0; }
.n { font-size: 34px; font-weight: 500; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
.n .dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; background: rgba(74,222,128,0.9); margin: 0 12px 6px 0; }
.l { margin-top: 6px; font-size: 15px; color: #c2c2c2; }
.url { position: absolute; right: 64px; top: 58px; font-family: "JetBrains Mono", monospace; font-size: 18px; color: #c2c2c2; }
</style></head><body>
<div class="hero"></div><div class="fade"></div><div class="noise"></div>
<div class="frame">
  <div class="brand">${mark}SDIQT</div>
  <div class="copy">
    <h1>Every rollup batch, proven and signed.</h1>
    <p class="sub">Hash-based STARK proofs and post-quantum receipts for QoreChain qledger rollups, checked in any browser.</p>
  </div>
  <div class="stats">
    <div class="stat"><div class="n"><span class="dot"></span>${stats.proven}</div><div class="l">sdiqt-1 batches STARK-proven</div></div>
    <div class="stat"><div class="n">${stats.batches}</div><div class="l">batches re-executed on ${stats.rollups} rollups</div></div>
    <div class="stat"><div class="n">${stats.rejected} of ${stats.wrong}</div><div class="l">wrong roots rejected on chain</div></div>
  </div>
</div>
<div class="url">sdiqt.xyz</div>
</body></html>`;
}

const browser = await chromium.launch();
try {
  const shots = [
    { out: join(APP, "public/og.png"), height: 630, scale: 1 },
    { out: join(ROOT, "docs/cover.png"), height: 675, scale: 1.6 },
  ];
  for (const s of shots) {
    const ctx = await browser.newContext({
      viewport: { width: 1200, height: s.height },
      deviceScaleFactor: s.scale,
    });
    const p = await ctx.newPage();
    await p.setContent(page(s.height), { waitUntil: "load" });
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: s.out, type: "png" });
    await ctx.close();
    console.log(
      JSON.stringify({ out: s.out, width: 1200 * s.scale, height: s.height * s.scale, ...stats }),
    );
  }
} finally {
  await browser.close();
}
