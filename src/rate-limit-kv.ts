import type { KVStore } from "./types";

/**
 * KV-backed rate limiting for Cloudflare Workers/Pages
 *
 * Stores rate buckets across requests; KV is eventually consistent, not an atomic limiter.
 * A configured but unavailable KV binding fails closed. Without a binding,
 * the legacy-compatible bounded isolate-local limiter is used.
 */

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch millis
}

export interface RateLimitConfig {
  limit: number; // max requests per window
  windowMs: number; // window duration in milliseconds
}

const DEFAULT_CONFIG: RateLimitConfig = {
  limit: 5,
  windowMs: 15 * 60 * 1000, // 15 minutes
};

const localBuckets = new Map<string, { count: number; resetAt: number }>();
const MAX_LOCAL_BUCKETS = 10000;
export function checkRateLimitMemory(
  clientKey: string,
  config: RateLimitConfig,
): RateLimitDecision {
  const now = Date.now();
  for (const [key, bucket] of localBuckets) {
    if (bucket.resetAt <= now) localBuckets.delete(key);
  }
  let bucket = localBuckets.get(clientKey);
  if (!bucket) {
    if (localBuckets.size >= MAX_LOCAL_BUCKETS)
      return { allowed: false, remaining: 0, resetAt: now + config.windowMs };
    bucket = { count: 0, resetAt: (Math.floor(now / config.windowMs) + 1) * config.windowMs };
    localBuckets.set(clientKey, bucket);
  }
  bucket.count = Math.min(bucket.count + 1, config.limit + 1);
  return {
    allowed: bucket.count <= config.limit,
    remaining: Math.max(0, config.limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

/**
 * Check and update rate limit using Cloudflare KV
 *
 * Uses a sliding window bucket approach:
 * - Key format: `rl:{windowId}:{clientKey}`
 * - Each window stores a count
 * - TTL ensures automatic cleanup
 *
 * @param kv - Cloudflare KV namespace
 * @param clientKey - Unique identifier for the client (hashed IP+email recommended)
 * @param config - Rate limit configuration
 * @returns Decision on whether request is allowed
 */
export async function checkRateLimitKV(
  kv: KVStore,
  clientKey: string,
  config: RateLimitConfig = DEFAULT_CONFIG,
): Promise<RateLimitDecision> {
  const now = Date.now();
  const { limit, windowMs } = config;

  // Calculate bucket key based on current time window
  const windowId = Math.floor(now / windowMs);
  const bucketKey = `rl:${windowId}:${clientKey}`;

  // Get current count for this window
  const raw = (await kv.get(bucketKey, "json")) as { count: number } | null;
  const currentCount = raw?.count ?? 0;
  const newCount = currentCount + 1;

  // Store updated count with TTL (2x window for safety margin)
  await kv.put(bucketKey, JSON.stringify({ count: newCount }), {
    expirationTtl: Math.ceil((windowMs / 1000) * 2),
  });

  // Calculate when this window resets
  const resetAt = (windowId + 1) * windowMs;

  return {
    allowed: newCount <= limit,
    remaining: Math.max(limit - newCount, 0),
    resetAt,
  };
}

/**
 * Generate a privacy-preserving client key from IP and optional identifier
 *
 * Hashes identifiers before storage; hashing is not a guarantee of anonymization.
 *
 * @param ip - Client IP address
 * @param identifier - Optional additional identifier (e.g., email)
 * @returns Hashed key suitable for rate limiting
 */
export async function generateClientKey(ip: string, identifier?: string): Promise<string> {
  const data = identifier ? `${ip}:${identifier}` : ip;
  const encoder = new TextEncoder();
  const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(data));
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Calculate Retry-After header value in seconds
 */
export function getRetryAfterSeconds(resetAt: number): number {
  return Math.ceil((resetAt - Date.now()) / 1000);
}
