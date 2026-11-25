#!/usr/bin/env node
/**
 * Link check for the explorer: renders each page in headless Chrome, collects
 * every <a href>, and checks that
 *   - in-page anchors (`/#id`, `#id`) name an element on the page,
 *   - internal routes render their own page (not the 404 page),
 *   - external links answer below HTTP 400.
 *
 *   node apps/explorer/scripts/check-links.mjs [base] (default http://localhost:5320)
 *   CHROME=/path/to/chrome overrides the browser.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = (process.argv[2] ?? "http://localhost:5320").replace(/\/$/, "");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE = mkdtempSync(join(tmpdir(), "sdiqt-links-"));
const PAGES = ["/", "/privacy", "/terms"];

function render(path) {
  return execFileSync(
    CHROME,
    [
      "--headless=new",
      `--user-data-dir=${PROFILE}`,
      "--virtual-time-budget=6000",
      "--dump-dom",
      `${BASE}${path}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 32 * 1024 * 1024 },
  );
}

const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
const hrefs = (html) =>
  [...html.matchAll(/<a\b[^>]*\shref="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
const isNotFound = (html) => /<span class="eyebrow">404<\/span>/.test(html);

const failures = [];
const seenExternal = new Map();
const rendered = new Map();
const page = (p) => {
  if (!rendered.has(p)) rendered.set(p, render(p));
  return rendered.get(p);
};

for (const p of PAGES) {
  const html = page(p);
  if (isNotFound(html)) failures.push(`${p}: renders the 404 page`);
  const links = hrefs(html);
  if (links.length === 0) failures.push(`${p}: no links found (page did not render?)`);
  for (const href of links) {
    if (/^https?:\/\//.test(href)) {
      if (!seenExternal.has(href)) seenExternal.set(href, p);
      continue;
    }
    const url = new URL(href, `${BASE}${p}`);
    const target = page(url.pathname);
    if (isNotFound(target)) failures.push(`${p}: ${href} -> 404 page`);
    if (url.hash && !ids(target).has(decodeURIComponent(url.hash.slice(1))))
      failures.push(`${p}: ${href} -> no element #${url.hash.slice(1)}`);
  }
}

await Promise.all(
  [...seenExternal].map(async ([href, from]) => {
    try {
      let res = await fetch(href, { method: "HEAD", redirect: "follow" });
      if (res.status === 405 || res.status === 403) res = await fetch(href, { redirect: "follow" });
      if (res.status >= 400) failures.push(`${from}: ${href} -> HTTP ${res.status}`);
    } catch (err) {
      failures.push(`${from}: ${href} -> ${err.message}`);
    }
  }),
);

const total = PAGES.reduce((n, p) => n + hrefs(page(p)).length, 0);
console.log(`checked ${total} links on ${PAGES.length} pages (${seenExternal.size} external)`);
if (failures.length) {
  for (const f of failures) console.log(`FAIL ${f}`);
  process.exit(1);
}
console.log("all links resolve");
