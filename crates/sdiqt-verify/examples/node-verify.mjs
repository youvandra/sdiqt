// Verify a chunk proof directory with the Node build of the wasm verifier:
//   node examples/node-verify.mjs <pkg-node-dir> <proof-dir>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const [pkgDir, proofDir] = process.argv.slice(2);
const { verifyChunk } = createRequire(import.meta.url)(
  join(process.cwd(), pkgDir, "sdiqt_verify.js"),
);
const read = (name) => readFileSync(join(proofDir, name));
const proof = read("chunk-0.proof.bin");
const pv = read("chunk-0.pv.bin");
const vkey = read("vkey-hash.bin");

function check(label, p) {
  const t = performance.now();
  try {
    verifyChunk(p, pv, vkey);
    console.log(`${label}: VALID in ${(performance.now() - t).toFixed(1)} ms`);
  } catch (err) {
    console.log(`${label}: INVALID in ${(performance.now() - t).toFixed(1)} ms (${err.message})`);
  }
}

check("original", proof);
const flipped = Buffer.from(proof);
flipped[flipped.length >> 1] ^= 1;
check("one byte flipped", flipped);
