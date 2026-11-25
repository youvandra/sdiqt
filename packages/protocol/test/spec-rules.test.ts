/**
 * Every MUST in `specs/` against the vectors: each normative rule carries an
 * id, and each id has at least one invalid vector in a `cases.json` under
 * `vectors/` that names the spec. Every spec also carries the BCP 14 boilerplate and a
 * security considerations section.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");
const load = (path: string) => JSON.parse(read(path));

/** Every `rule` value anywhere in a cases file. */
function rulesIn(value: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) for (const v of value) rulesIn(v, out);
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k === "rule" && typeof v === "string") out.add(v);
      else rulesIn(v, out);
    }
  }
  return out;
}

const BOILERPLATE =
  'The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "NOT RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in BCP 14 [RFC2119] [RFC8174] when, and only when, they appear in all capitals, as shown here.';

const caseFiles = readdirSync(new URL("vectors/", root), { recursive: true, encoding: "utf8" })
  .filter((p) => p.endsWith("cases.json"))
  .map((p) => `vectors/${p}`);

describe("specs", () => {
  const specs = readdirSync(new URL("specs/", root)).filter((f) => f.endsWith(".md"));
  const covered = new Map<string, Set<string>>();
  for (const f of caseFiles) {
    const c = load(f);
    const set = covered.get(c.spec) ?? new Set<string>();
    for (const r of rulesIn(c)) set.add(r);
    covered.set(c.spec, set);
  }

  it.each(specs)("%s has the BCP 14 boilerplate and security considerations", (f) => {
    const text = read(`specs/${f}`);
    expect(text).toContain(BOILERPLATE);
    expect(text).toMatch(/^## Security considerations$/m);
  });

  it.each(specs)("%s: every MUST has an id and an invalid vector", (f) => {
    const text = read(`specs/${f}`).replace(BOILERPLATE, "");
    const ids = new Set<string>();
    for (const line of text.split("\n")) {
      if (!/\bMUST\b/.test(line)) continue;
      const id = /\*\*([A-Z]+-[0-9]+)\.\*\*/.exec(line)?.[1];
      expect(id, `${f}: a MUST without a rule id: ${line}`).toBeDefined();
      ids.add(id as string);
    }
    const have = covered.get(`specs/${f}`) ?? new Set<string>();
    for (const id of ids) expect(have.has(id), `${f}: ${id} has no invalid vector`).toBe(true);
    for (const id of have) expect(ids.has(id), `${f}: vectors cite unknown rule ${id}`).toBe(true);
  });
});
