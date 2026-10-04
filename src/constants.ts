export const API = {
  CONTACT: {
    MAX_NAME_LENGTH: 100,
    MAX_EMAIL_LENGTH: 254,
    MAX_SUBJECT_LENGTH: 200,
    MAX_MESSAGE_LENGTH: 5000,
    MAX_TURNSTILE_TOKEN_LENGTH: 2048,
    MAX_REQUEST_BODY_SIZE: 16384,
  },
} as const;
export const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
};
