# Turnstile contact core

ESM core for the existing Turnstile workflow, built by Vite Plus Pack. Consumers own markup, origins and private bindings. Version 0.1.7 adds a shared native client alongside the unchanged 0.1.3 server behavior. Frozen earlier archives remain unchanged. Owner code is MIT OR Apache-2.0; complete notices are packed and dependency licenses remain separate.

## Install and native adapters

```sh
npm install @effortlessmetrics/contact-core@0.1.8
```

A Fetch-compatible adapter passes its private bindings without bundling them in
browser code. Contact stays disabled unless `CONTACT_ENABLED` is exactly `true`.
The host must supply the trusted platform IP header; keep server bindings private.

```ts
import {
  handleContactPost,
  handleContactOptions,
  handleContactGet,
  type ContactEnv,
} from "@effortlessmetrics/contact-core";

type ContactContext = { request: Request; env: ContactEnv };
export const onRequestPost = ({ request, env }: ContactContext) =>
  handleContactPost(request, env);
export const onRequestOptions = ({ request, env }: ContactContext) =>
  handleContactOptions(request, env);
export const onRequestGet = () => handleContactGet();
```

Mount the client after native form markup exists. This example uses the indicated
`data-*` attributes inside a form with labelled `name`, `email`, `subject` and
`message` fields and their documented native length limits. The accepted indicator
and retry button start hidden. Supply only the public Turnstile site key here;
the returned function belongs in the consumer's navigation/unmount lifecycle.

```ts
import { mountContactForm } from "@effortlessmetrics/contact-core/client";

export function mountExample(form: HTMLFormElement, publicSiteKey: string) {
  const required = <T extends HTMLElement>(selector: string): T => {
    const element = form.querySelector<T>(selector);
    if (!element) throw new Error(`Missing contact element: ${selector}`);
    return element;
  };
  return mountContactForm({
    form,
    sitekey: publicSiteKey,
    challenge: required<HTMLElement>("[data-challenge]"),
    verificationStatus: required<HTMLElement>("[data-verification-status]"),
    deliveryStatus: required<HTMLElement>("[data-delivery-status]"),
    submitButton: required<HTMLButtonElement>("button[type=submit]"),
    acceptedIndicator: required<HTMLElement>("[data-accepted]"),
    retryVerificationButton: required<HTMLButtonElement>("[data-retry-verification]"),
    persistDraft: false,
  });
}
```

The example keeps drafts only in the open form. Omit `persistDraft: false` to use
the documented local draft persistence policy. Route `/api/contact` to the server
adapter; labels, statuses, accepted-state styling and hosting remain consumer-owned.

## Semantic presentation API (unreleased source candidate)

The maintained source adds optional `messages` keyed by exported `ContactMessageCode`.
Published 0.1.8 does not yet include this API. Omit overrides to retain every default
message. Keys are `verification-ready`, `verification-expired`, `verification-failed`,
`verification-offline`, `verification-reconnected`, `verification-load-failed`,
`delivery-sending`, `delivery-accepted`, `delivery-client-timeout`,
`delivery-network-error`, `delivery-server-timeout`, `delivery-rejected`,
`delivery-form-unavailable` and `delivery-service-unavailable`. Server rejection text
is preserved unless its corresponding override is supplied. A 504 response selects
`delivery-server-timeout` without assuming which provider timed out. POST availability
responses carry additive JSON `code: "form-unavailable"` or `"service-unavailable"`;
existing text, status and disabled/configuration behavior are unchanged. When old
endpoints omit machine codes, the producer also recognizes known legacy form/service
unavailability messages for optional overrides; consumers do not compare English text.

For example, pass `messages: { "delivery-network-error": "Please reconnect and retry." }`
to the mount options. The delivery-status element also emits bubbling
`contact:delivery-state` events with exported `ContactDeliveryState` detail containing
only `state` and optional `code`. Consumers can focus their error status through this
event instead of observing or comparing English text. No form values, identifiers,
tokens or private bindings are included. An accepted event describes the submitted
request; later edits retain their draft and hide the indicator. These options affect
presentation only;
acceptance, draft persistence, verification and delivery identity are unchanged.

## Shared client integration

Version 0.1.7 defers provider loading while initially offline and starts fresh verification after reconnect, without sending. Supply an initially hidden native `retryVerificationButton` labelled by the consumer (for example, Retry verification). Load failure, expiry and challenge failure expose this control; clicking retries verification in place without reload and preserves fields and delivery identity. It never submits the form.

Personal consumers retain draft persistence by default. Set `persistDraft: false` for a current-open-page-only policy: the client never reads, writes or clears storage, including old drafts. The form's current values still survive verification failures, retry and offline/reconnect. `draftKey` matters only when persistence is enabled. No site-specific browser fork is needed.

Import `mountContactForm` from `@effortlessmetrics/contact-core/client`, never the server root into a browser bundle. The client entry has no server imports, private bindings or framework dependency. Supply the native `form`, challenge container, verification status, delivery status, submit button and an initially hidden accepted indicator, plus the existing public `sitekey` and optional `action`. Optional `endpoint` defaults to `/api/contact`; `draftKey` defaults to the existing `contact-form-draft`. Native fields are named `name`, `email`, `subject`, `message`; labels, limits, button text and site styles stay with the consumer. The returned disposer removes listeners/widget and cancels in-flight requests. Repeated mounting of the same form is idempotent.

The client separately updates verification and delivery status. Only HTTP success **and** JSON `success: true` mark acceptance. The consumer's small green check is revealed through `acceptedIndicator.hidden = false`; its aria-hidden visual is accompanied by the polite, atomic delivery-status announcement `Message sent.`. Server thank-you text is not rendered. The client sets `data-contact-state` to `idle`, `sending`, `accepted` or `error` on the form and delivery status. Style only the accepted status as visually hidden (standard sr-only styling), keeping sending/error text visible; do not give the delivery element an unconditional hidden class. Keep the native submit button's label unchanged and style the indicator with the site's green success color. Verification alone never displays delivery acceptance or sends.

An accepted request clears its unchanged draft and rotates identity. New input clears the accepted indicator; unchanged failed retries retain identity and obtain a fresh token. Later failure cannot retain a previous green check. Editing while a request is pending preserves the new draft and does not show acceptance for that edited content. Offline/reconnect, compact challenge sizing, expiry and errors do not submit automatically or overwrite delivery errors. Timeout text preserves the existing ambiguity/possible-duplicate warning. All qualification uses synthetic tokens and intercepted requests, with no live CAPTCHA or email.

## Contract

Exports handleContactPost, handleContactOptions, handleContactGet and structural ContactEnv/KVStore types. Required: CONTACT_ENABLED=true, exact HTTPS CONTACT_ALLOWED_ORIGINS, CONTACT_TURNSTILE_HOSTNAME matching the origin host, CONTACT_FROM, CONTACT_TO, TURNSTILE_SECRET_KEY and either RESEND_API_KEY or existing MAILGUN_API_KEY/MAILGUN_DOMAIN. The platform supplies trusted CF-Connecting-IP. Consumer adapters own existing sender/recipient aliases. No defaults, wildcard allowlist or private addresses are bundled.

CONTACT_TURNSTILE_ACTION is optional for the established action-free widget. When configured, the action must be valid and match exactly. Token success and hostname always require verification. CAPTCHA verification is never retried and times out after five seconds. Origin constraints are not authentication.

POST JSON: name (100), email (254), subject (200), message (5000), turnstileToken (2048). Additive requestId, if supplied, must be UUID v4. Streamed body cap is 16 KiB. Header controls are rejected and HTML escapes user content; legitimate code stays text. No bodies, tokens, credentials or addresses are logged. Clients retain fields on failure and get a fresh token; unchanged retries retain requestId.

Configured Resend is always selected, with bounded retry and a stable hashed idempotency key tied to origin/action, sender/recipient, identifier and fields. Without requestId the legacy token is the identifier; a fresh token cannot provide the same cross-request idempotency guarantee. Resend failure never switches providers. Only absent Resend selects Mailgun, preserving escaped HTML/text and reply-to. Mailgun times out after eight seconds and has no automatic retries because ambiguous sends lack an equivalent idempotency contract. Acceptance is not inbox delivery or exactly-once delivery. Errors offer no email/mailto fallback.

## Rate limits and qualification

IP counted once before parsing (5/hour); email only after valid CAPTCHA (3/hour). No site-wide bucket. Configured KV failures remain closed; eventual consistency and non-atomic increments can undercount. Without KV, the existing compatibility fallback caps isolate-local hashed buckets at 10,000, expires hourly windows, caps counters and rejects new buckets at capacity. It does not persist across isolate restart or coordinate across isolates; this is not a globally precise limiter. Hashing is not anonymity. No new namespace or permission is required.

npm ci, npm test and npm run test:packed build ESM/declarations, typecheck, test mocked endpoints, independently install a local tarball with scripts disabled and rerun endpoints through that package without source aliases. Coverage includes strict/action-free configurations, original fields, origin/host/action and replay failures, input/escaping, absent-KV rate limits and configured-KV failure, Resend idempotency/retries and Mailgun selection/errors/timeouts. No live CAPTCHA or email is used.

No credentials, widget keys, account provisioning, private application content or personal font/photo binaries are included.

Timeout guidance distinguishes verification from ambiguous delivery. Only Resend requests with requestId describe a stable retry identifier; Mailgun and legacy Resend requests warn that a new attempt may duplicate delivery. Twenty endpoint test designs run both emitted and through an independent packed install; three additional mock-time memory tests cover limits, capacity and expiry.

Offline/reconnect invalidates the old widget generation. Fresh verification renders a new widget; stale success/error/expiry callbacks cannot enable submission or replace current status.

## Runtime and release preparation

The package is ESM-only. The server root uses standard Fetch, Web Crypto, FormData
and TextEncoder APIs; consumers supply the trusted platform IP header and optional
structural KV binding. Node imports require the declared Node engine. No runtime
npm dependencies or framework peers are required. Importing either entry during
SSR is safe; call `mountContactForm` only in a browser with native DOM APIs, secure
context Web Crypto and AbortController. It is not an SSR renderer.

Packed qualification checks the file allowlist and public provenance, imports the
client without a DOM in Node, resolves both public entries and their types through
independent NodeNext and Bundler consumers, then runs mocked endpoint and browser
cases. Source files are intentionally shipped for inspection; scripts, tests,
qualification records, lockfiles and credentials are excluded.

Version 0.1.8 is published on the public npm registry. Its qualified source is
commit `0e12af21b2d3624c3d2f63d3c6172948b34e6ef2`; the immutable archive SHA256 is
`48d2d910c4e70d0459c9d398aa990d4a5e3beca26581059f3e0ca0fd3d32dd03`.
Later documentation-only source changes do not replace those published bytes.
A future registry release needs its own version and approval. Prepare it from a
clean checkout with `npm ci`,
`npm test`, `npm run test:packed`, then review `npm pack --dry-run --json`, the exact
archive integrity and complete license notices. Do not publish from qualification
consumer directories. The `prepack` hook rebuilds `dist` before every normal pack; do not bypass scripts
when producing a release archive. Independent consumers install with scripts disabled.
Run `npm run test:rollback` after packed qualification for an isolated published 0.1.8 ->
source candidate -> published 0.1.8 endpoint/browser receipt. The check downloads
only the public package archive and verifies its recorded integrity; it calls no
real verification or email provider. Set `CONTACT_PREVIOUS_ARCHIVE` to an existing
archive to qualify an older baseline. The same rollback check runs in producer CI. Keep candidate archives in their unique
qualification directories; never overwrite an earlier archive.

Before upgrading a consumer, retain its previous archive and lockfile, install the
candidate with scripts disabled, and run that consumer's local endpoint/browser
checks against the candidate. Confirm persistence policy, adapter binding aliases,
verification recovery and acceptance status. Record both archive integrities and
consumer heads. Roll back by restoring the previous archive dependency and lockfile,
reinstalling and repeating the same checks. Package upgrade/rollback does not itself
authorize changing live bindings or deploying either site.
