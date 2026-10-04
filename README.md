# Turnstile contact core

Private ESM core for the existing Turnstile workflow, built by Vite Plus Pack. Consumers own markup, origins and private bindings. Version 0.1.2 restores the personal workflow alongside strict business configuration. Frozen earlier archives remain unchanged. Owner code is MIT OR Apache-2.0; complete notices are packed and dependency licenses remain separate.

## Contract

Exports handleContactPost, handleContactOptions, handleContactGet and structural ContactEnv/KVStore types. Required: CONTACT_ENABLED=true, exact HTTPS CONTACT_ALLOWED_ORIGINS, CONTACT_TURNSTILE_HOSTNAME matching the origin host, CONTACT_FROM, CONTACT_TO, TURNSTILE_SECRET_KEY and either RESEND_API_KEY or existing MAILGUN_API_KEY/MAILGUN_DOMAIN. The platform supplies trusted CF-Connecting-IP. Consumer adapters own existing sender/recipient aliases. No defaults, wildcard allowlist or private addresses are bundled.

CONTACT_TURNSTILE_ACTION is optional for the established action-free widget. When configured, the action must be valid and match exactly. Token success and hostname always require verification. CAPTCHA verification is never retried and times out after five seconds. Origin constraints are not authentication.

POST JSON: name (100), email (254), subject (200), message (5000), turnstileToken (2048). Additive requestId, if supplied, must be UUID v4. Streamed body cap is 16 KiB. Header controls are rejected and HTML escapes user content; legitimate code stays text. No bodies, tokens, credentials or addresses are logged. Clients retain fields on failure and get a fresh token; unchanged retries retain requestId.

Configured Resend is always selected, with bounded retry and a stable hashed idempotency key tied to origin/action, sender/recipient, identifier and fields. Without requestId the legacy token is the identifier; a fresh token cannot provide the same cross-request idempotency guarantee. Resend failure never switches providers. Only absent Resend selects Mailgun, preserving escaped HTML/text and reply-to. Mailgun times out after eight seconds and has no automatic retries because ambiguous sends lack an equivalent idempotency contract. Acceptance is not inbox delivery or exactly-once delivery. Errors offer no email/mailto fallback.

## Rate limits and qualification

IP counted once before parsing (5/hour); email only after valid CAPTCHA (3/hour). No site-wide bucket. Configured KV failures remain closed; eventual consistency and non-atomic increments can undercount. Without KV, the existing compatibility fallback caps isolate-local hashed buckets at 10,000, expires hourly windows, caps counters and rejects new buckets at capacity. It does not persist across isolate restart or coordinate across isolates; this is not a globally precise limiter. Hashing is not anonymity. No new namespace or permission is required.

npm ci, npm test and npm run test:packed build ESM/declarations, typecheck, test mocked endpoints, independently install a private tarball with scripts disabled and rerun endpoints through that package without source aliases. Coverage includes strict/action-free configurations, original fields, origin/host/action and replay failures, input/escaping, absent-KV rate limits and configured-KV failure, Resend idempotency/retries and Mailgun selection/errors/timeouts. No live CAPTCHA or email is used.

No deployment, registry publication, credentials, widget keys, account provisioning, private application content or personal font/photo binaries are included.
