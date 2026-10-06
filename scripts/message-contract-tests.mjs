import assert from "node:assert/strict";
const core = await import(process.env.CONTACT_PACKED_MODULE || "../dist/index.js");
const disabled = await core.handleContactPost(new Request("https://example.test/api/contact"), {});
assert.equal(disabled.status, 503);
assert.equal((await disabled.json()).code, "form-unavailable");
const service = await core.handleContactPost(
  new Request("https://example.test/api/contact", {
    method: "POST",
    headers: { Origin: "https://example.test", "CF-Connecting-IP": "synthetic" },
  }),
  {
    CONTACT_ENABLED: "true",
    CONTACT_ALLOWED_ORIGINS: "https://example.test",
    CONTACT_TURNSTILE_HOSTNAME: "example.test",
    CONTACT_FROM: "mock",
    CONTACT_TO: "mock",
    TURNSTILE_SECRET_KEY: "mock",
    RESEND_API_KEY: "mock",
    CONTACT_RATE_LIMIT: {
      get: async () => {
        throw Error("Mock KV unavailable");
      },
      put: async () => {},
    },
  },
);
assert.equal(service.status, 502);
assert.equal((await service.json()).code, "service-unavailable");
console.log(JSON.stringify({ semanticErrorCodes: 2, pass: true, mocked: true }));
