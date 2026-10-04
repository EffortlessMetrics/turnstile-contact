import { fetchWithTimeout, type FetchTimeoutOptions, FetchTimeoutError } from "./fetch-timeout";

export interface FetchRetryOptions extends FetchTimeoutOptions {
  retries?: number;
  backoffMs?: number;
  retryCondition?: (error: Error, attempt: number, lastResponse?: Response) => boolean;
}

export class FetchRetryError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(message: string, attempts: number, lastError: Error) {
    super(message);
    this.name = "FetchRetryError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Fetches a resource with automatic retry logic and exponential backoff.
 *
 * @param url - The URL to fetch
 * @param options - Fetch options with retry configuration
 * @returns Promise resolving to the Response
 * @throws FetchRetryError if all retries are exhausted
 *
 * @example
 * ```ts
 * // Retry up to 2 times with 1s base backoff
 * const res = await fetchWithRetry('https://api.example.com/data', {
 *   timeout: 10_000,
 *   retries: 2,
 *   backoffMs: 1_000,
 * });
 * ```
 */
export async function fetchWithRetry(
  url: string | URL | Request,
  {
    retries = 2,
    backoffMs = 1000,
    retryCondition = defaultRetryCondition,
    ...fetchOptions
  }: FetchRetryOptions = {},
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, fetchOptions);

      // Check if response status indicates we should retry
      if (response.status >= 500 && response.status < 600) {
        // Server error - release connection quickly
        try {
          // Prefer cancel() when available; fall back to consuming the body
          if (response.body?.cancel) await response.body.cancel();
          else await response.text();
        } catch {
          // Ignore cleanup errors
        }

        const error = new Error(`HTTP ${response.status}: ${response.statusText}`);

        // If we have retries left and should retry, wait and continue
        if (attempt < retries && retryCondition(error, attempt, response)) {
          lastError = error;
          await sleep(calculateBackoff(attempt, backoffMs));
          continue;
        }

        // Last attempt with 5xx - throw error
        if (attempt >= retries) {
          lastError = error;
          break;
        }
      }

      return response;
    } catch (error) {
      if (!(error instanceof Error)) {
        throw error;
      }

      lastError = error;

      // Don't retry if we've exhausted attempts
      if (attempt >= retries) {
        break;
      }

      // Check if this error should trigger a retry
      if (!retryCondition(error, attempt)) {
        throw error;
      }

      // Wait before retrying with exponential backoff
      await sleep(calculateBackoff(attempt, backoffMs));
    }
  }

  // All retries exhausted
  throw new FetchRetryError(
    `Failed after ${retries + 1} attempts: ${url.toString()}`,
    retries + 1,
    lastError!,
  );
}

/**
 * Default retry condition - retries on network errors, timeouts, and 5xx errors.
 * Does NOT retry on 4xx client errors (bad request, unauthorized, etc.)
 */
export function defaultRetryCondition(
  error: Error,
  _attempt: number,
  lastResponse?: Response,
): boolean {
  // Don't retry 4xx client errors (bad input, auth issues, etc.)
  if (lastResponse && lastResponse.status >= 400 && lastResponse.status < 500) {
    return false;
  }

  // Retry on 5xx server errors
  if (lastResponse && lastResponse.status >= 500 && lastResponse.status < 600) {
    return true;
  }

  // Retry on timeout errors
  if (error instanceof FetchTimeoutError) {
    return true;
  }

  // Retry on network errors (AbortError is handled by FetchTimeoutError)
  if (error.name === "TypeError" && error.message.includes("fetch")) {
    return true;
  }

  // Don't retry other errors by default
  return false;
}

/**
 * Calculate backoff delay with exponential increase and jitter
 */
function calculateBackoff(attempt: number, baseMs: number): number {
  const exponential = baseMs * 2 ** attempt;
  const jitter = Math.random() * 200; // 0-200ms random jitter
  return Math.min(exponential + jitter, 30_000); // Cap at 30 seconds
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
