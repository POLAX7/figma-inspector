/**
 * figma-fetcher.ts
 * 
 * Production-ready HTTP client for calling Figma REST API with strict rate-limiting resilience:
 * 1. Max retry cap (default: 3 attempts)
 * 2. Circuit breaker on long cooldowns (maxWaitSeconds: 60s - aborts immediately on monthly quota exhaustion)
 * 3. Fast-fail on non-retryable 4xx errors (400, 401, 403, 404)
 * 4. Exponential backoff with random jitter if Retry-After header is missing
 */

export interface RetryConfig {
  maxRetries?: number;      // Maximum number of retry attempts (default: 3)
  maxAttempts?: number;     // Total requests, including the initial request
  maxWaitSeconds?: number;  // Max allowable wait seconds before circuit-breaking (default: 60)
  customFetch?: typeof fetch;
  signal?: AbortSignal;
  requestTimeoutMs?: number;
}

export class FigmaRateLimitError extends Error {
  public status: number;
  public retryAfter?: number;
  public planTier?: string;
  public rateLimitType?: string;
  public upgradeLink?: string;

  constructor(message: string, status: number, retryAfter?: number, planTier?: string, rateLimitType?: string, upgradeLink?: string) {
    super(message);
    this.name = 'FigmaRateLimitError';
    this.status = status;
    this.retryAfter = retryAfter;
    this.planTier = planTier;
    this.rateLimitType = rateLimitType;
    this.upgradeLink = upgradeLink;
  }
}

function safeUrlForLog(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}

/**
 * Executes a fetch request with strict Figma rate-limit handling and circuit-breaking.
 */
export async function fetchFigmaWithRetry(
  url: string,
  options: RequestInit = {},
  config: RetryConfig = {}
): Promise<Response> {
  const maxAttempts = config.maxAttempts ?? ((config.maxRetries ?? 3) + 1);
  const { maxWaitSeconds = 60, customFetch = fetch, signal, requestTimeoutMs } = config;
  const sleep = (seconds: number) => new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason || new Error('Request aborted'));
    const timer = setTimeout(resolve, Math.max(0, seconds * 1000));
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason || new Error('Request aborted'));
    }, { once: true });
  });

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw signal.reason || new Error('Request aborted');
    let response: Response;
    try {
      const timeoutSignal = requestTimeoutMs !== undefined ? AbortSignal.timeout(requestTimeoutMs) : undefined;
      const requestSignal = signal && timeoutSignal
        ? AbortSignal.any([signal, timeoutSignal])
        : (signal || timeoutSignal);
      const requestOptions = requestSignal ? { ...options, signal: requestSignal } : options;
      response = await customFetch(url, requestOptions);
    } catch (err) {
      if (signal?.aborted || attempt >= maxAttempts) throw err;
      await sleep(Math.min(Math.pow(2, attempt - 1) + Math.random(), maxWaitSeconds));
      continue;
    }

    // 1. Return immediately on success
    if (response.ok) {
      return response;
    }

    // 2. Fast-fail on non-retryable 4xx client errors (400, 401, 403, 404)
    if (response.status !== 429 && response.status >= 400 && response.status < 500) {
      throw new Error(`[Figma API Client Error] ${response.status} ${response.statusText} at ${safeUrlForLog(url)}`);
    }

    const retryable = response.status === 429 || [500, 502, 503, 504].includes(response.status);
    if (!retryable) {
      throw new Error(`[Figma API Server Error] ${response.status} ${response.statusText} at ${safeUrlForLog(url)}`);
    }

    // 3. Check if the total attempt budget is exhausted
    if (attempt >= maxAttempts) {
      const planTier = response.headers.get('X-Figma-Plan-Tier') || 'unknown';
      throw new FigmaRateLimitError(
        `[Figma API] Exceeded maximum attempts (${maxAttempts}). Status: ${response.status} ${response.statusText}`,
        response.status,
        undefined,
        planTier,
        response.headers.get('X-Figma-Rate-Limit-Type') || undefined,
        response.headers.get('X-Figma-Upgrade-Link') || undefined
      );
    }

    // 4. Parse Retry-After header
    const retryAfterHeader = response.headers.get('Retry-After');
    const parsedRetryAfter = retryAfterHeader === null ? NaN : Number(retryAfterHeader);
    let waitSeconds = Number.isFinite(parsedRetryAfter) && parsedRetryAfter >= 0
      ? parsedRetryAfter
      : NaN;

    // Fallback: Exponential backoff (1s, 2s, 4s...) + jitter
    if (Number.isNaN(waitSeconds)) {
      waitSeconds = Math.pow(2, attempt - 1) + Math.random();
    }

    // 5. Circuit Breaker: Abort if wait time exceeds max threshold (e.g. monthly quota exhausted)
    if (waitSeconds > maxWaitSeconds) {
      const planTier = response.headers.get('X-Figma-Plan-Tier') || 'unknown';
      throw new FigmaRateLimitError(
        `[Figma API Circuit Breaker] Retry-After required waiting ${waitSeconds}s, exceeding threshold (${maxWaitSeconds}s). Plan tier: "${planTier}". Quota likely exhausted; aborting.`,
        response.status,
        waitSeconds,
        planTier,
        response.headers.get('X-Figma-Rate-Limit-Type') || undefined,
        response.headers.get('X-Figma-Upgrade-Link') || undefined
      );
    }

    console.warn(`[Figma API ${response.status}] Retrying attempt ${attempt + 1}/${maxAttempts} after waiting ${Math.round(waitSeconds)}s...`);
    await sleep(waitSeconds);
  }

  throw new Error('[Figma API] Retry loop exited unexpectedly');
}
