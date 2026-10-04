import assert from "node:assert/strict";
import { checkRateLimitMemory } from "../src/rate-limit-kv.ts";
const originalNow = Date.now;
let now = 3_600_000 * 100;
Date.now = () => now;
const config = { limit: 2, windowMs: 3_600_000 };
try {
  assert.equal(checkRateLimitMemory("existing", config).remaining, 1);
  assert.equal(checkRateLimitMemory("existing", config).allowed, true);
  assert.equal(checkRateLimitMemory("existing", config).allowed, false);
  for (let i = 1; i < 10000; i++)
    assert.equal(checkRateLimitMemory("capacity-" + i, config).allowed, true);
  const denied = checkRateLimitMemory("at-capacity", config);
  assert.equal(denied.allowed, false);
  assert.equal(denied.resetAt, now + config.windowMs);
  assert.equal(checkRateLimitMemory("capacity-1", config).allowed, true);
  now += config.windowMs + 1;
  const fresh = checkRateLimitMemory("at-capacity", config);
  assert.equal(fresh.allowed, true);
  assert.equal(fresh.remaining, 1);
  assert.equal(checkRateLimitMemory("existing", config).allowed, true);
  console.log(
    JSON.stringify({
      memoryLimiterBranches: 3,
      pass: true,
      mockTime: true,
      checks: [
        "counter limit",
        "capacity preserves active buckets",
        "expired buckets free capacity and reset limits",
      ],
    }),
  );
} finally {
  Date.now = originalNow;
}
