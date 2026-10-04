export interface FetchTimeoutOptions extends RequestInit {
  timeout?: number;
}

export class FetchTimeoutError extends Error {
  constructor(url: string, timeout: number) {
    super(`Fetch timeout after ${timeout}ms: ${url}`);
    this.name = "FetchTimeoutError";
  }
}

export async function fetchWithTimeout(
  url: string | URL | Request,
  options: FetchTimeoutOptions = {},
): Promise<Response> {
  const { timeout = 30000, signal, ...fetchOptions } = options;

  if (typeof AbortSignal !== "undefined" && "timeout" in AbortSignal && !signal) {
    try {
      const timeoutSignal = AbortSignal.timeout(timeout);
      return await fetch(url, { ...fetchOptions, signal: timeoutSignal });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new FetchTimeoutError(url.toString(), timeout);
      }
      throw error;
    }
  }

  const controller = new AbortController();
  let timeoutCause: "timeout" | "external" | null = null;

  const timeoutId = setTimeout(() => {
    timeoutCause = "timeout";
    controller.abort();
  }, timeout);

  if (signal) {
    signal.addEventListener("abort", () => {
      if (timeoutCause !== "timeout") {
        timeoutCause = "external";
      }
      controller.abort();
    });
  }

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError") &&
      timeoutCause === "timeout"
    ) {
      throw new FetchTimeoutError(url.toString(), timeout);
    }
    throw error;
  }
}
