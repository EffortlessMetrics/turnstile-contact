export interface KVStore {
  get(key: string, type: "json"): Promise<unknown>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
}
export interface ContactEnv {
  CONTACT_ENABLED?: string;
  CONTACT_ALLOWED_ORIGINS?: string;
  CONTACT_TURNSTILE_HOSTNAME?: string;
  CONTACT_TURNSTILE_ACTION?: string;
  CONTACT_FROM?: string;
  CONTACT_TO?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  MAILGUN_API_KEY?: string;
  MAILGUN_DOMAIN?: string;
  CONTACT_RATE_LIMIT?: KVStore;
}
