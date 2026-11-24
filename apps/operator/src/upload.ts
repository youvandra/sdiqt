/**
 * Bundle upload: after a bundle verifies on the Mac it is copied to the host
 * with rsync over SSH (`user@host:/srv/sdiqt/bundles`), where nginx serves it
 * next to the explorer. It runs before the QSTR post, so every posted
 * commitment points at a bundle that can already be fetched.
 *
 * A destination without `host:` is a local directory, which tests use.
 */
import { spawn } from "node:child_process";
import { basename } from "node:path";

export type BundleUploader = (bundleDir: string) => Promise<{ url: string }>;

export interface RsyncUploaderOptions {
  /** `user@host:/srv/sdiqt/bundles` or a local directory that exists. */
  dest: string;
  /** Public base URL the host serves the bundles under, for the log. */
  publicBase?: string;
  rsync?: string;
}

export function rsyncUploader(o: RsyncUploaderOptions): BundleUploader {
  return async (bundleDir) => {
    const name = basename(bundleDir);
    if (!/^batch-[0-9]+-[0-9A-F]{12}$/.test(name)) {
      throw new Error(`refusing to upload ${bundleDir}: not a bundle directory name`);
    }
    const target = `${o.dest.replace(/\/$/, "")}/${name}/`;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        o.rsync ?? "rsync",
        ["-a", "--checksum", `${bundleDir.replace(/\/$/, "")}/`, target],
        {
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let err = "";
      child.stderr.on("data", (d: Buffer) => {
        err += d.toString();
      });
      child.on("error", reject);
      child.on("close", (code) =>
        code === 0
          ? resolve()
          : reject(new Error(`rsync to ${target} exited with ${code}: ${err.trim()}`)),
      );
    });
    return { url: o.publicBase ? `${o.publicBase.replace(/\/$/, "")}/${name}/` : target };
  };
}
