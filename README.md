# Turnstile contact core

A small TypeScript core for an existing Turnstile + Resend email form. Consumers own markup, styling, domains and bindings. There is no form backend account setup, deployment or npm publication here.

Version 0.1.1 is an ESM package with declarations, built by Vite+ Pack for Astro/Cloudflare Pages bundlers. The package is marked private to prevent accidental registry publication; the MIT source repository and versioned pack artifact can be consumed directly.

## Contract

Exports: `handleContactPost(request, env)`, `handleContactOptions(request, env)`, `handleContactGet()`, plus `ContactEnv` and structural `KVStore` types. Pages adapters are a few lines; no Astro or Cloudflare type dependency is imported by the core. Both the business landing and personal publishing consumers supply their own exact same-origin domain and distinct widget action. This is not a generic provider/plugin framework.

Required environment: `CONTACT_ENABLED=true`, `CONTACT_ALLOWED_ORIGINS` (comma-separated exact HTTPS origins, no inherited defaults or wildcard), `CONTACT_TURNSTILE_HOSTNAME` (the request host), `CONTACT_TURNSTILE_ACTION` (consumer-selected action), `CONTACT_FROM`, `CONTACT_TO`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, and `CONTACT_RATE_LIMIT` (KV binding). The platform must supply trusted `CF-Connecting-IP`. Missing configuration or binding fails closed; there is no in-memory production fallback.

POST JSON: name (100 chars), email (254), subject (200), message (5000), turnstileToken (2048), requestId (UUID v4). Bodies are streamed with a 16KiB cap. Reject missing/disallowed/mismatched Origin before vendor calls. Origin checks are request constraints, not authentication; token success, hostname and action are verified server-side. CAPTCHA validation is not automatically retried.

Strict type/length/control validation and HTML-context escaping keep all user fields safe at the email boundary. Legitimate code snippets are preserved as text; arbitrary SQL/constructor keyword stripping is deliberately excluded. Email/subject header controls are rejected. No request bodies, tokens, credentials or emails are logged.

Responses are JSON `{success:true,message}` or `{error}` with no-store headers. Success means provider acceptance, not inbox delivery. The client should retain fields and requestId on failure, get a fresh CAPTCHA token for retry, and change the identifier only when content changes or a send succeeds. Client timeout is 30s; CAPTCHA timeout 5s; email timeout 8s with one bounded retry.

Provider retries use a stable hashed idempotency key bound to consumer origin/action, from/to, requestId and sanitized fields. Cross-consumer deliveries do not share a key. Resend's idempotency window is finite; this is not unlimited exactly-once delivery. Fields are not persisted by this package.

IP buckets are counted once before parsing (5/hour). Email buckets are counted once only after valid CAPTCHA (3/hour). There is no shared origin bucket: invalid requests cannot consume a site-wide allowance or unverified email capacity. KV has a one-write/second/key limit, is eventually consistent and read/modify/write is not atomic; concurrent requests sharing an IP or verified email can still fail closed or undercount. Distinct visitors have no shared write key. this is a best-effort anti-abuse layer, not a globally precise counter. Hashed identifiers are not a guarantee of anonymity. Binding/capacity policy is the consumer's deployment decision.

## Verification and reuse

`npm ci && npm test` runs Vite+ Pack and verifies its emitted ESM exports, declarations, type checks and mocked endpoint tests. Tests cover missing config, origin rejection, malformed/oversized/header-injection input, CAPTCHA replay/hostname/action failures, rate accounting/failure, contextual escaping, retry idempotency, provider errors and timeout classification. No live CAPTCHA or email is performed. Consumer browser tests should additionally check fields, accessible failure feedback, timeout and disabled preview behavior.

The business consumer integrates the packed version through a thin Pages adapter and its independently styled Astro component. The personal rebuild adopts the same request/response contract with its own origin/action/configuration; no live personal-site code/configuration is modified by this export.

`npm pack` produces the local versioned source artifact. No credentials, widget keys, allowlists, provider accounts or KV namespaces are provisioned by this repository.

## Mechanism disposition

| Mechanism | Decision | Verification |
| --- | --- | --- |
| Contact field, token and delivery contract | Keep | Two synthetic consumer configurations and negative endpoint tests |
| Origin/token binding, rate counting, retries | Adapt | Exact origin/action/hostname and stable provider-key assertions |
| Custom production bundling | Native replacement | Vite+ 1.0 `vp pack`, emitted ESM and declarations |
| Personal form UI, account configuration, brand helpers, logs and storage fallback | Retire from this package | No runtime framework dependencies; consumer owns bindings/UI |

Tests execute emitted JavaScript rather than a second production bundling workaround. The versioned archive includes emitted output so consumers need neither Vite+ nor TypeScript at runtime.

0.1.1 removes the shared origin bucket and moves email accounting after token verification. Published 0.1.0 is retained unchanged; consumers should upgrade their pinned artifact.
