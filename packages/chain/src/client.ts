import { createRdkClient, type RdkClient } from "@qorechain/rdk";
import { CHAIN_REST_URL } from "@sdiqt/protocol";
import { type RetryOptions, retryingFetch } from "./fetch.ts";

/** A read client for diana with retrying HTTP. */
export function createChainClient(
  options: { restUrl?: string; retry?: RetryOptions } = {},
): RdkClient {
  return createRdkClient({
    network: "testnet",
    endpoints: { rest: options.restUrl ?? CHAIN_REST_URL },
    fetch: retryingFetch(options.retry),
  });
}
