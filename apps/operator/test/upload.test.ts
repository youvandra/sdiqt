import { readFileSync } from "node:fs";
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rsyncUploader } from "../src/index.ts";

const GOLDEN = new URL("../../../vectors/bundles/golden-v328/", import.meta.url).pathname;

async function bundle(name: string): Promise<string> {
  const dir = join(await mkdtemp(join(tmpdir(), "sdiqt-src-")), name);
  await cp(GOLDEN, dir, { recursive: true });
  return dir;
}

describe("bundle upload", () => {
  it("copies the bundle byte for byte and reports the public URL", async () => {
    const dest = await mkdtemp(join(tmpdir(), "sdiqt-dest-"));
    const src = await bundle("batch-0-929C7A21066A");
    const up = rsyncUploader({ dest, publicBase: "https://sdiqt.xyz/bundles/" });
    expect(await up(src)).toEqual({ url: "https://sdiqt.xyz/bundles/batch-0-929C7A21066A/" });
    for (const f of ["manifest.json", "chunk-0.bin", "chunk-2.bin"]) {
      expect(readFileSync(join(dest, "batch-0-929C7A21066A", f))).toEqual(
        readFileSync(join(src, f)),
      );
    }
    // A second upload of the same bundle is a no-op that still succeeds.
    await expect(up(src)).resolves.toBeDefined();
  });

  it("refuses a directory that is not a bundle", async () => {
    const dest = await mkdtemp(join(tmpdir(), "sdiqt-dest-"));
    await expect(rsyncUploader({ dest })(await bundle("home"))).rejects.toThrow(/not a bundle/);
  });

  it("fails loudly when the destination is missing", async () => {
    const up = rsyncUploader({ dest: "/nonexistent/sdiqt/bundles" });
    await expect(up(await bundle("batch-1-FACE91C0D4D1"))).rejects.toThrow(/rsync/);
  });
});
