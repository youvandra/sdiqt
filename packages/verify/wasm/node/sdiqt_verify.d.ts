/* tslint:disable */
/* eslint-disable */
/**
 * Browser and Node entry point for one chunk. Returns on a valid proof
 * and throws the rejection reason otherwise.
 */
export function verifyChunk(proof: Uint8Array, public_values: Uint8Array, vkey_hash: Uint8Array): void;
/**
 * Whole-bundle entry point: `proofs` holds every chunk proof back to back
 * and `lengths` their sizes, in chunk order. Returns on a valid bundle
 * whose linked claim equals its manifest and throws the reason otherwise.
 */
export function verifyBundle(manifest_json: string, proofs: Uint8Array, lengths: Uint32Array, expected_vkey_hash?: string | null): void;
