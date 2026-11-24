/**
 * `fetch` with retries for the public QoreChain endpoints: 429 and 5xx answers
 * and network errors back off exponentially with jitter, honouring
 * `Retry-After`. Other answers are returned to the caller unchanged.
 */

export interface RetryOptions {
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  fetch?: typeof fetch;
}

const DEFAULTS = { attempts: 5, baseDelayMs: 500, maxDelayMs: 8_000 } as const;
const USER_AGENT = "sdiqt/0.1";

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryable(status: number): boolean {
  return status === 429 || status >= 500;
}

function delayFor(
  attempt: number,
  response: Response | undefined,
  opts: Required<Omit<RetryOptions, "fetch" | "sleep">>,
): number {
  const header = response?.headers.get("retry-after");
  const seconds = header ? Number(header) : Number.NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, opts.maxDelayMs);
  const backoff = Math.min(opts.baseDelayMs * 2 ** attempt, opts.maxDelayMs);
  return backoff / 2 + Math.random() * (backoff / 2);
}

export function retryingFetch(options: RetryOptions = {}): typeof fetch {
  const opts = { ...DEFAULTS, ...options };
  const inner = options.fetch ?? fetch;
  const sleep = options.sleep ?? wait;

  return async (input, init) => {
    const headers = new Headers(init?.headers);
    if (!headers.has("user-agent")) headers.set("user-agent", USER_AGENT);
    let lastError: unknown;
    for (let attempt = 0; attempt < opts.attempts; attempt++) {
      let response: Response | undefined;
      try {
        response = await inner(input, { ...init, headers });
        if (!retryable(response.status) || attempt === opts.attempts - 1) return response;
      } catch (err) {
        lastError = err;
        if (attempt === opts.attempts - 1) break;
      }
      await sleep(delayFor(attempt, response, opts));
    }
    throw lastError;
  };
}
