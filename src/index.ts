import { fetchWithTimeout, FetchTimeoutError } from "./fetch-timeout";
import { fetchWithRetry, FetchRetryError } from "./fetch-retry";
import { sanitizeContactForm, sanitizeEmail, escapeHtml } from "./sanitize";
import { ValidationError } from "./errors";
import { API, SECURITY_HEADERS } from "./constants";
import { allowedOrigins } from "./origins";
import {
  checkRateLimitKV,
  checkRateLimitMemory,
  generateClientKey,
  getRetryAfterSeconds,
} from "./rate-limit-kv";
import type { ContactEnv } from "./types";

type Context = { request: Request; env: ContactEnv };
class RequestError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
function response(status: number, body: object, origin?: string, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...SECURITY_HEADERS,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      Vary: "Origin",
      ...(origin ? { "Access-Control-Allow-Origin": origin } : {}),
      ...extra,
    },
  });
}
function requestOrigin({ request, env }: Context): string | undefined {
  const origin = request.headers.get("Origin");
  return origin &&
    origin === new URL(request.url).origin &&
    allowedOrigins(env.CONTACT_ALLOWED_ORIGINS).includes(origin)
    ? origin
    : undefined;
}
async function readBody(request: Request) {
  if (!request.headers.get("Content-Type")?.toLowerCase().startsWith("application/json"))
    throw new RequestError(415, "Use a JSON request.");
  if (Number(request.headers.get("Content-Length")) > API.CONTACT.MAX_REQUEST_BODY_SIZE)
    throw new RequestError(413, "Message is too large.");
  if (!request.body) throw new RequestError(400, "Invalid request.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > API.CONTACT.MAX_REQUEST_BODY_SIZE) {
        await reader.cancel();
        throw new RequestError(413, "Message is too large.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError(400, "Invalid request.");
  }
}
function validate(raw: unknown) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new RequestError(400, "Check your message fields.");
  const data = raw as Record<string, unknown>;
  for (const [key, max] of Object.entries({
    name: 100,
    email: 254,
    subject: 200,
    message: 5000,
    turnstileToken: 2048,
  })) {
    if (
      typeof data[key] !== "string" ||
      !(data[key] as string).trim() ||
      (data[key] as string).length > max
    )
      throw new RequestError(400, "Check your message fields.");
  }
  if (
    data.requestId !== undefined &&
    (typeof data.requestId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        data.requestId as string,
      ))
  )
    throw new RequestError(400, "Invalid request identifier.");
  if (/[\r\n\u0000]/.test(data.email as string) || /[\r\n\u0000]/.test(data.subject as string))
    throw new RequestError(400, "Check your email and subject.");
  const email = sanitizeEmail(data.email as string);
  const clean = sanitizeContactForm(data as unknown as Parameters<typeof sanitizeContactForm>[0]);
  if (!clean.name.trim() || !clean.message.trim() || !clean.subject?.trim())
    throw new RequestError(400, "Check your message fields.");
  return {
    ...clean,
    email,
    turnstileToken: (data.turnstileToken as string).trim(),
    requestId: typeof data.requestId === "string" ? data.requestId : undefined,
  };
}
export async function handleContactPost(request: Request, env: ContactEnv): Promise<Response> {
  const context = { request, env };
  if (env.CONTACT_ENABLED !== "true")
    return response(503, {
      error: "The form is unavailable. Please try again later.",
      code: "form-unavailable",
    });
  const origin = requestOrigin(context);
  if (!origin) return response(403, { error: "Request origin is not allowed." });
  const hostname = new URL(origin).hostname;
  if (
    !env.TURNSTILE_SECRET_KEY ||
    (!env.RESEND_API_KEY &&
      (!env.MAILGUN_API_KEY ||
        !env.MAILGUN_DOMAIN ||
        !/^[a-zA-Z0-9.-]+$/.test(env.MAILGUN_DOMAIN))) ||
    !env.CONTACT_FROM ||
    !env.CONTACT_TO ||
    env.CONTACT_TURNSTILE_HOSTNAME !== hostname ||
    (env.CONTACT_TURNSTILE_ACTION !== undefined &&
      !/^[a-zA-Z0-9_-]{1,32}$/.test(env.CONTACT_TURNSTILE_ACTION))
  )
    return response(
      503,
      { error: "The form is unavailable. Please try again later.", code: "form-unavailable" },
      origin,
    );
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip)
    return response(
      503,
      { error: "The form is unavailable. Please try again later.", code: "form-unavailable" },
      origin,
    );
  let deliveryStarted = false;
  let stableDeliveryIdentifier = false;
  try {
    // Each request consumes its IP bucket once; verified CAPTCHA gates email accounting. No shared origin bucket.
    const consume = async (factor: string, value: string, limit: number) => {
      const bucket =
        factor +
        ":" +
        (await generateClientKey(
          origin + "|" + (env.CONTACT_TURNSTILE_ACTION ?? "") + "|" + value,
        ));
      const config = { limit, windowMs: 3600000 };
      const decision = env.CONTACT_RATE_LIMIT
        ? await checkRateLimitKV(env.CONTACT_RATE_LIMIT, bucket, config)
        : checkRateLimitMemory(bucket, config);
      if (!decision.allowed)
        throw new RequestError(429, String(Math.max(1, getRetryAfterSeconds(decision.resetAt))));
    };
    await consume("ip", ip, 5);

    const data = validate(await readBody(request));
    stableDeliveryIdentifier = Boolean(env.RESEND_API_KEY && data.requestId);

    const verified = await fetchWithTimeout(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          secret: env.TURNSTILE_SECRET_KEY,
          response: data.turnstileToken,
          remoteip: ip,
        }),
        timeout: 5000,
      },
    );
    if (!verified.ok) throw new RequestError(502, "Verification is unavailable. Please try again.");
    const captcha = (await verified.json()) as {
      success?: boolean;
      hostname?: string;
      action?: string;
    };
    if (
      captcha.success !== true ||
      captcha.hostname !== hostname ||
      (env.CONTACT_TURNSTILE_ACTION !== undefined &&
        captcha.action !== env.CONTACT_TURNSTILE_ACTION)
    )
      throw new RequestError(400, "Verification failed. Please try again.");
    await consume("email", data.email, 3);
    const key = await generateClientKey(
      JSON.stringify([
        origin,
        env.CONTACT_TURNSTILE_ACTION,
        env.CONTACT_FROM,
        env.CONTACT_TO,
        data.requestId ?? data.turnstileToken,
        data.name,
        data.email,
        data.subject,
        data.message,
      ]),
    );
    const html = `<h2>Contact enquiry</h2><p>Name: ${escapeHtml(data.name)}</p><p>Email: ${escapeHtml(data.email)}</p><p>Subject: ${escapeHtml(data.subject!)}</p><p>${escapeHtml(data.message).replace(/\n/g, "<br>")}</p>`;
    deliveryStarted = true;
    const sent = env.RESEND_API_KEY
      ? await fetchWithRetry("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.RESEND_API_KEY}`,
            "Content-Type": "application/json",
            "Idempotency-Key": "contact/" + key,
          },
          body: JSON.stringify({
            from: env.CONTACT_FROM,
            to: env.CONTACT_TO,
            reply_to: data.email,
            subject: "Contact Form: " + data.subject,
            html,
          }),
          timeout: 8000,
          retries: 1,
          backoffMs: 500,
        })
      : await sendMailgun(env, data, html);
    if (!sent.ok)
      throw new RequestError(
        502,
        "The email service could not accept your message. Please try again.",
      );
    return response(200, { success: true, message: "Message accepted. Thank you." }, origin);
  } catch (error) {
    if (error instanceof RequestError) {
      if (error.status === 429)
        return response(429, { error: "Too many attempts. Please try later." }, origin, {
          "Retry-After": error.message,
        });
      return response(error.status, { error: error.message }, origin);
    }
    if (error instanceof ValidationError)
      return response(400, { error: "Check your message fields." }, origin);
    if (error instanceof FetchTimeoutError || error instanceof FetchRetryError)
      return response(
        504,
        {
          error: !deliveryStarted
            ? "Verification timed out. Please try again with fresh verification."
            : stableDeliveryIdentifier
              ? "The email service timed out. Your message may have been accepted; retrying unchanged uses the same Resend delivery identifier."
              : "The email service timed out. Your message may have been accepted. Please wait before retrying; another attempt may deliver a duplicate.",
        },
        origin,
      );
    return response(
      502,
      { error: "The service is unavailable. Please try again later.", code: "service-unavailable" },
      origin,
    );
  }
}
async function sendMailgun(
  env: ContactEnv,
  data: { name: string; email: string; subject?: string; message: string },
  html: string,
) {
  const form = new FormData();
  form.set("from", env.CONTACT_FROM!);
  form.set("to", env.CONTACT_TO!);
  form.set("h:Reply-To", data.email);
  form.set("subject", "Contact Form: " + data.subject);
  form.set(
    "text",
    `Name: ${data.name}\nEmail: ${data.email}\nSubject: ${data.subject}\n\n${data.message}`,
  );
  form.set("html", html);
  // Mailgun has no equivalent idempotency contract. Do not automatically retry
  // ambiguous sends or switch providers after a configured Resend failure.
  return fetchWithTimeout(`https://api.mailgun.net/v3/${env.MAILGUN_DOMAIN}/messages`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa("api:" + env.MAILGUN_API_KEY) },
    body: form,
    timeout: 8000,
  });
}
export async function handleContactOptions(request: Request, env: ContactEnv) {
  const context = { request, env };
  if (context.env.CONTACT_ENABLED !== "true") return response(503, { error: "Form unavailable." });
  const origin = requestOrigin(context);
  if (!origin) return response(403, { error: "Request origin is not allowed." });
  return new Response(null, {
    status: 204,
    headers: {
      ...SECURITY_HEADERS,
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      Vary: "Origin",
    },
  });
}
export const handleContactGet = () =>
  response(405, { error: "Use POST." }, undefined, { Allow: "POST, OPTIONS" });

export type { ContactEnv, KVStore } from "./types";
