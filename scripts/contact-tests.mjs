import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
await mkdir(".evidence", { recursive: true });
const core = await import(process.env.CONTACT_PACKED_MODULE || "../dist/index.js");
const onRequestPost = ({ request, env }) => core.handleContactPost(request, env);
const onRequestOptions = ({ request, env }) => core.handleContactOptions(request, env);
const origin = "https://business.example";
const body = {
  name: "Example Team",
  email: "team@example.com",
  subject: "One bottleneck",
  message: "Please review the export workflow.",
  turnstileToken: "mock-token",
  requestId: "12345678-1234-4123-8123-123456789abc",
};
function kv() {
  const values = new Map();
  return {
    values,
    async get(key) {
      return values.has(key) ? JSON.parse(values.get(key)) : null;
    },
    async put(key, value) {
      values.set(key, value);
    },
  };
}
function env() {
  return {
    CONTACT_ENABLED: "true",
    CONTACT_ALLOWED_ORIGINS: origin,
    CONTACT_TURNSTILE_HOSTNAME: "business.example",
    CONTACT_TURNSTILE_ACTION: "business-contact",
    CONTACT_FROM: "approved-sender@example.com",
    CONTACT_TO: "recipient@example.com",
    TURNSTILE_SECRET_KEY: "mock-secret-not-a-credential",
    RESEND_API_KEY: "mock-key-not-a-credential",
    CONTACT_RATE_LIMIT: kv(),
  };
}
function request(payload = body, headers = {}, url = origin + "/api/contact") {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      "CF-Connecting-IP": "192.0.2.1",
      ...headers,
    },
    body: typeof payload === "string" ? payload : JSON.stringify(payload),
  });
}
let calls = [],
  captcha = { success: true, hostname: "business.example", action: "business-contact" },
  vendor = [];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), options });
  if (String(url).includes("/siteverify"))
    return new Response(JSON.stringify(captcha), { status: 200 });
  if (
    String(url) === "https://api.resend.com/emails" ||
    String(url).startsWith("https://api.mailgun.net/v3/")
  ) {
    const item = vendor.shift();
    if (item instanceof Error) throw item;
    return new Response("{}", { status: item ?? 200 });
  }
  throw new Error("Unexpected network request");
};
const results = [];
async function check(name, run) {
  calls = [];
  captcha = { success: true, hostname: "business.example", action: "business-contact" };
  vendor = [];
  await run();
  results.push({ name, pass: true });
}
try {
  await check("disabled or incomplete config fails closed", async () => {
    for (const missing of [
      "CONTACT_ENABLED",
      "CONTACT_FROM",
      "CONTACT_TO",
      "TURNSTILE_SECRET_KEY",
      "RESEND_API_KEY",
      "CONTACT_TURNSTILE_HOSTNAME",
    ]) {
      const e = env();
      delete e[missing];
      assert.equal((await onRequestPost({ request: request(), env: e })).status, 503);
    }
    assert.equal(calls.length, 0);
  });
  await check("reject missing, forged, personal and mismatched origins before work", async () => {
    for (const value of [
      "",
      "null",
      "https://unapproved.example",
      "https://unapproved-portfolio.example",
      origin + "/path",
    ]) {
      assert.equal(
        (await onRequestPost({ request: request(body, { Origin: value }), env: env() })).status,
        403,
      );
    }
    assert.equal(
      (
        await onRequestPost({
          request: request(body, {}, "https://preview.example/api/contact"),
          env: env(),
        })
      ).status,
      403,
    );
    assert.equal(calls.length, 0);
  });
  await check("preflight rejects invalid origin; valid origin is exact", async () => {
    const e = env();
    assert.equal(
      (await onRequestOptions({ request: request(body, { Origin: "null" }), env: e })).status,
      403,
    );
    const r = await onRequestOptions({ request: request(), env: e });
    assert.equal(r.status, 204);
    assert.equal(r.headers.get("Access-Control-Allow-Origin"), origin);
  });
  await check("malformed, oversized, header injection and invalid fields rejected", async () => {
    for (const payload of [
      "{",
      [],
      { ...body, email: "not-an-email" },
      { ...body, email: "a@example.com\r\nBcc:x@example.com" },
      { ...body, subject: "hello\r\nheader" },
      { ...body, name: 5 },
      { ...body, name: "x".repeat(101) },
      { ...body, turnstileToken: "x".repeat(2049) },
      { ...body, requestId: "not-a-uuid" },
    ])
      assert.equal((await onRequestPost({ request: request(payload), env: env() })).status, 400);
    assert.equal(
      (await onRequestPost({ request: request("x".repeat(17000)), env: env() })).status,
      413,
    );
    assert.equal(
      (
        await onRequestPost({
          request: request(body, { "Content-Type": "text/plain" }),
          env: env(),
        })
      ).status,
      415,
    );
    assert.equal(calls.length, 0);
  });
  await check("single increment per IP and verified email; no shared origin bucket", async () => {
    const e = env();
    assert.equal((await onRequestPost({ request: request(), env: e })).status, 200);
    const counts = [...e.CONTACT_RATE_LIMIT.values.values()].map((x) => JSON.parse(x).count);
    assert.deepEqual(counts, [1, 1]);
    assert.equal((await onRequestPost({ request: request(), env: e })).status, 200);
    assert.deepEqual(
      [...e.CONTACT_RATE_LIMIT.values.values()].map((x) => JSON.parse(x).count),
      [2, 2],
    );
  });
  await check("email limit returns retry after without vendor work", async () => {
    const e = env();
    for (let i = 0; i < 3; i++)
      assert.equal((await onRequestPost({ request: request(), env: e })).status, 200);
    calls = [];
    const r = await onRequestPost({ request: request(), env: e });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get("Retry-After")) > 0);
    assert.equal(calls.filter((c) => c.url.includes("resend")).length, 0);
    assert.equal(calls.filter((c) => c.url.includes("siteverify")).length, 1);
  });
  await check("KV failure and missing Cloudflare IP fail closed", async () => {
    const e = env();
    e.CONTACT_RATE_LIMIT.get = async () => {
      throw new Error("KV unavailable");
    };
    assert.equal((await onRequestPost({ request: request(), env: e })).status, 502);
    assert.equal(
      (await onRequestPost({ request: request(body, { "CF-Connecting-IP": "" }), env: env() }))
        .status,
      503,
    );
    assert.equal(calls.length, 0);
  });
  await check("Turnstile failure, replay, hostname and action mismatch do not send", async () => {
    for (const value of [
      { success: false, "error-codes": ["timeout-or-duplicate"] },
      { success: true, hostname: "other.example", action: "business-contact" },
      { success: true, hostname: "business.example", action: "other" },
      { success: true },
    ]) {
      captcha = value;
      calls = [];
      assert.equal((await onRequestPost({ request: request(), env: env() })).status, 400);
      assert.equal(calls.filter((c) => c.url.includes("resend")).length, 0);
    }
  });
  await check(
    "escapes user fields without discarding legitimate code; accepted result is no-store",
    async () => {
      const r = await onRequestPost({
        request: request({
          ...body,
          name: "<b>Example</b>",
          message:
            "<script>alert(1)</script><img src=x onerror=alert(1)>review & verify constructor / DROP TABLE",
        }),
        env: env(),
      });
      assert.equal(r.status, 200);
      assert.equal(r.headers.get("Cache-Control"), "no-store");
      assert.equal((await r.json()).success, true);
      const sent = JSON.parse(calls.at(-1).options.body);
      assert.doesNotMatch(sent.html, /<script|<img/i);
      assert.match(sent.html, /&lt;script&gt;/);
      assert.match(sent.html, /&amp;/);
      assert.match(sent.html, /constructor/);
      assert.match(sent.html, /DROP TABLE/);
      assert.equal(sent.reply_to, "team@example.com");
    },
  );
  await check(
    "provider retries use one stable idempotency key and no extra rate counts",
    async () => {
      const e = env();
      vendor = [500, 200];
      assert.equal((await onRequestPost({ request: request(), env: e })).status, 200);
      const sent = calls.filter((c) => c.url.includes("resend"));
      assert.equal(sent.length, 2);
      assert.equal(
        sent[0].options.headers["Idempotency-Key"],
        sent[1].options.headers["Idempotency-Key"],
      );
      assert.deepEqual(
        [...e.CONTACT_RATE_LIMIT.values.values()].map((x) => JSON.parse(x).count),
        [1, 1],
      );
      const key = sent[0].options.headers["Idempotency-Key"];
      calls = [];
      assert.equal(
        (
          await onRequestPost({
            request: request({ ...body, turnstileToken: "new-token" }),
            env: env(),
          })
        ).status,
        200,
      );
      assert.equal(calls.at(-1).options.headers["Idempotency-Key"], key);
    },
  );
  await check(
    "provider 4xx is not retried; exhausted retries return explicit failure",
    async () => {
      vendor = [403];
      assert.equal((await onRequestPost({ request: request(), env: env() })).status, 502);
      assert.equal(calls.filter((c) => c.url.includes("resend")).length, 1);
      calls = [];
      vendor = [503, 503];
      assert.equal((await onRequestPost({ request: request(), env: env() })).status, 504);
      assert.equal(calls.filter((c) => c.url.includes("resend")).length, 2);
    },
  );
  await check("independent portfolio consumer has isolated action and delivery key", async () => {
    const first = await onRequestPost({ request: request(), env: env() });
    assert.equal(first.status, 200);
    const businessKey = calls.at(-1).options.headers["Idempotency-Key"];
    calls = [];
    const e = env();
    const portfolio = "https://portfolio.example";
    e.CONTACT_ALLOWED_ORIGINS = portfolio;
    e.CONTACT_TURNSTILE_HOSTNAME = "portfolio.example";
    e.CONTACT_TURNSTILE_ACTION = "portfolio-contact";
    captcha = { success: true, hostname: "portfolio.example", action: "portfolio-contact" };
    const r = new Request(portfolio + "/api/contact", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: portfolio,
        "CF-Connecting-IP": "192.0.2.1",
      },
      body: JSON.stringify(body),
    });
    assert.equal((await onRequestPost({ request: r, env: e })).status, 200);
    assert.notEqual(calls.at(-1).options.headers["Idempotency-Key"], businessKey);
  });
  await check("invalid traffic cannot consume shared or verified-email capacity", async () => {
    const e = env();
    for (const ip of ["192.0.2.10", "192.0.2.11"])
      for (let i = 0; i < 5; i++) {
        const bad = request("{", { "CF-Connecting-IP": ip });
        assert.equal((await onRequestPost({ request: bad, env: e })).status, 400);
      }
    assert.equal(e.CONTACT_RATE_LIMIT.values.size, 2);
    assert.ok([...e.CONTACT_RATE_LIMIT.values.keys()].every((k) => k.includes(":ip:")));
    assert.equal(calls.length, 0);
    captcha = { success: false };
    const bad = request(body, { "CF-Connecting-IP": "192.0.2.12" });
    assert.equal((await onRequestPost({ request: bad, env: e })).status, 400);
    assert.ok([...e.CONTACT_RATE_LIMIT.values.keys()].every((k) => k.includes(":ip:")));
    captcha = { success: true, hostname: new URL(origin).hostname, action: "business-contact" };
    assert.equal(
      (
        await onRequestPost({
          request: request(body, { "CF-Connecting-IP": "192.0.2.13" }),
          env: e,
        })
      ).status,
      200,
    );
    assert.equal(
      [...e.CONTACT_RATE_LIMIT.values.keys()].filter((k) => k.includes(":email:")).length,
      1,
    );
  });
  await check("distinct concurrent visitors avoid shared KV write contention", async () => {
    const e = env(),
      writing = new Set();
    const put = e.CONTACT_RATE_LIMIT.put;
    e.CONTACT_RATE_LIMIT.put = async (k, v) => {
      if (writing.has(k)) throw new Error("KV one-key write contention");
      writing.add(k);
      await new Promise((r) => setImmediate(r));
      try {
        await put(k, v);
      } finally {
        writing.delete(k);
      }
    };
    const results = await Promise.all(
      [1, 2, 3].map((i) =>
        onRequestPost({
          request: request(
            { ...body, email: "team" + i + "@example.com" },
            { "CF-Connecting-IP": "192.0.2." + (20 + i) },
          ),
          env: e,
        }),
      ),
    );
    assert.deepEqual(
      results.map((r) => r.status),
      [200, 200, 200],
    );
    assert.equal(e.CONTACT_RATE_LIMIT.values.size, 6);
  });
  await check("native timeout classification, not inbox delivery", async () => {
    const mod = { onRequestPost };
    const prior = globalThis.fetch;
    globalThis.fetch = async () => {
      const error = new Error("timeout");
      error.name = "TimeoutError";
      throw error;
    };
    try {
      assert.equal((await mod.onRequestPost({ request: request(), env: env() })).status, 504);
    } finally {
      globalThis.fetch = prior;
    }
  });
  await check(
    "legacy action-free widget and four-field contract retain host verification",
    async () => {
      const e = env();
      delete e.CONTACT_TURNSTILE_ACTION;
      captcha = { success: true, hostname: "business.example" };
      const legacy = { ...body };
      delete legacy.requestId;
      assert.equal((await onRequestPost({ request: request(legacy), env: e })).status, 200);
      assert.ok(calls.at(-1).options.headers["Idempotency-Key"]);
      captcha = { success: true, hostname: "unapproved.example" };
      assert.equal((await onRequestPost({ request: request(legacy), env: e })).status, 400);
      captcha = { success: false };
      assert.equal((await onRequestPost({ request: request(legacy), env: e })).status, 400);
      e.CONTACT_TURNSTILE_ACTION = "";
      assert.equal((await onRequestPost({ request: request(legacy), env: e })).status, 503);
    },
  );
  await check(
    "optional KV retains bounded isolate-local IP and verified email limits",
    async () => {
      const e = env();
      delete e.CONTACT_RATE_LIMIT;
      for (let i = 0; i < 5; i++)
        assert.equal(
          (
            await onRequestPost({
              request: request("{", { "CF-Connecting-IP": "192.0.2.90" }),
              env: e,
            })
          ).status,
          400,
        );
      const blocked = await onRequestPost({
        request: request(body, { "CF-Connecting-IP": "192.0.2.90" }),
        env: e,
      });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("Retry-After")) > 0);
      for (let i = 0; i < 4; i++)
        assert.equal(
          (
            await onRequestPost({
              request: request(
                { ...body, email: "limited@example.com" },
                { "CF-Connecting-IP": "192.0.2." + (91 + i) },
              ),
              env: e,
            })
          ).status,
          i < 3 ? 200 : 429,
        );
      assert.equal(calls.filter((c) => c.url.includes("resend")).length, 3);
    },
  );
  await check(
    "Mailgun only when Resend is unconfigured, with escaped reply-to delivery",
    async () => {
      const e = env();
      delete e.RESEND_API_KEY;
      e.MAILGUN_API_KEY = "mock-mailgun";
      e.MAILGUN_DOMAIN = "mail.example";
      assert.equal(
        (
          await onRequestPost({
            request: request({ ...body, message: "<script>example</script>\ncode" }),
            env: e,
          })
        ).status,
        200,
      );
      const sent = calls.at(-1);
      assert.equal(sent.url, "https://api.mailgun.net/v3/mail.example/messages");
      assert.equal(sent.options.body.get("h:Reply-To"), body.email);
      assert.match(sent.options.body.get("html"), /&lt;script&gt;/);
      assert.equal(sent.options.body.get("to"), e.CONTACT_TO);
      assert.equal(sent.options.headers.Authorization, "Basic " + btoa("api:mock-mailgun"));
      calls = [];
      e.RESEND_API_KEY = "mock-resend";
      vendor = [403];
      assert.equal((await onRequestPost({ request: request(), env: e })).status, 502);
      assert.equal(calls.filter((c) => c.url.includes("mailgun")).length, 0);
      calls = [];
      delete e.RESEND_API_KEY;
      e.MAILGUN_DOMAIN = "mail.example/attacker";
      assert.equal((await onRequestPost({ request: request(), env: e })).status, 503);
      assert.equal(calls.length, 0);
    },
  );
  await check(
    "Mailgun ambiguous sends are not retried and errors offer no public email fallback",
    async () => {
      const e = env();
      delete e.RESEND_API_KEY;
      e.MAILGUN_API_KEY = "mock-mailgun";
      e.MAILGUN_DOMAIN = "mail.example";
      vendor = [503];
      const failed = await onRequestPost({ request: request(), env: e });
      assert.equal(failed.status, 502);
      assert.equal(calls.filter((c) => c.url.includes("mailgun")).length, 1);
      assert.doesNotMatch(await failed.text(), /use email|mailto:|recipient@example/);
      const prior = globalThis.fetch;
      globalThis.fetch = async (url, options) => {
        if (String(url).includes("mailgun")) {
          const error = new Error("timeout");
          error.name = "TimeoutError";
          throw error;
        }
        return prior(url, options);
      };
      try {
        assert.equal((await onRequestPost({ request: request(), env: e })).status, 504);
      } finally {
        globalThis.fetch = prior;
      }
    },
  );
  await check(
    "timeout guidance promises stable identity only for Resend with requestId",
    async () => {
      for (const kind of ["resend-id", "resend-legacy", "mailgun"]) {
        const e = env(),
          data = { ...body };
        if (kind === "resend-legacy") delete data.requestId;
        if (kind === "mailgun") {
          delete e.RESEND_API_KEY;
          e.MAILGUN_API_KEY = "mock-mailgun";
          e.MAILGUN_DOMAIN = "mail.example";
        }
        let sends = 0;
        const prior = globalThis.fetch;
        globalThis.fetch = async (url, options) => {
          if (String(url).includes("siteverify")) return prior(url, options);
          sends++;
          const error = new Error("ambiguous provider timeout");
          error.name = "TimeoutError";
          throw error;
        };
        try {
          const result = await onRequestPost({ request: request(data), env: e });
          assert.equal(result.status, 504);
          const text = await result.text();
          if (kind === "resend-id") assert.match(text, /same Resend delivery identifier/);
          else {
            assert.match(text, /may deliver a duplicate/);
            assert.doesNotMatch(text, /same .*identifier/);
          }
          assert.equal(sends, kind === "mailgun" ? 1 : 2);
        } finally {
          globalThis.fetch = prior;
        }
      }
    },
  );
  await writeFile(
    ".evidence/contact-tests.json",
    JSON.stringify(
      { mocked: true, liveEmailSent: false, liveCaptchaCompleted: false, results },
      null,
      2,
    ) + "\n",
  );
  console.log(JSON.stringify({ contactTests: results.length, pass: true, mocked: true }));
} finally {
  globalThis.fetch = originalFetch;
}
