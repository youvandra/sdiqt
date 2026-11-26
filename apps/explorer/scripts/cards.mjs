/**
 * Renders the link-preview image and the 16:9 submission cover.
 *
 *   node scripts/cards.mjs
 *
 * Writes public/og.png (1200 x 630) and ../../docs/cover.png (1920 x 1080): the
 * brand hero, the name and one line, kept inside the middle band so a wide
 * banner crop (about 2.8:1, as the fest's project page shows it) loses nothing.
 * The images carry no counts, so they stay true as the rollup grows; live
 * numbers live in PROOF.md and the explorer.
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = join(HERE, "..");
const ROOT = join(APP, "../..");

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
  '<svg viewBox="0 0 20 20" width="34" height="34" aria-hidden="true"><path d="M0 0h5v5H0zM7 0h5v5H7zM0 7.5h5v5H0zM7 7.5h5v5H7zM0 15h5v5H0zM7 15h5v5H7zM17 7l3 3-3 3-3-3z" fill="#fff"/></svg>';

function page(height) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face { font-family: Inter; font-weight: 100 900; src: url("${asset("fonts/InterVariable.woff2")}") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; src: url("${asset("fonts/JetBrainsMono.woff2")}") format("woff2"); }
* { box-sizing: border-box; margin: 0; }
html, body { width: 1200px; height: ${height}px; background: #000; color: #fff; overflow: hidden; }
body { font-family: Inter, sans-serif; position: relative; -webkit-font-smoothing: antialiased; }
.hero { position: absolute; top: 50%; right: -190px; width: 1000px; height: 667px; transform: translateY(-50%); background: url("${asset("brand/hero.png")}") center / cover no-repeat; }
.fade { position: absolute; inset: 0; background: linear-gradient(90deg, #000 30%, rgba(0,0,0,0.5) 52%, rgba(0,0,0,0) 72%); }
.noise { position: absolute; inset: 0; background: url("${asset("brand/noise.png")}"); opacity: 0.16; mix-blend-mode: overlay; }
.frame { position: absolute; inset: 0; padding: 0 72px; display: flex; flex-direction: column; justify-content: center; }
.brand { display: flex; align-items: center; gap: 16px; font-size: 34px; font-weight: 600; letter-spacing: -0.01em; }
h1 { margin-top: 28px; max-width: 900px; font-size: 84px; line-height: 1.02; font-weight: 500; letter-spacing: -0.04em; }
</style></head><body>
<div class="hero"></div><div class="fade"></div><div class="noise"></div>
<div class="frame">
  <div class="brand">${mark}SDIQT</div>
  <h1>Proof that outlives<br>the chain.</h1>
</div>
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
    console.log(JSON.stringify({ out: s.out, width: 1200 * s.scale, height: s.height * s.scale }));
  }
} finally {
  await browser.close();
}
