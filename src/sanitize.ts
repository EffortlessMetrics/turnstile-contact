import { API } from "./constants";
import { ValidationError } from "./errors";
// Contextual HTML escaping adapted from the existing MIT-licensed contact flow.
const entities: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#x27;",
  "/": "&#x2F;",
};
export const escapeHtml = (value: string) => value.replace(/[&<>"'/]/g, (char) => entities[char]);
export function sanitizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length > API.CONTACT.MAX_EMAIL_LENGTH ||
    /[\u0000-\u0020\u007f]/.test(email) ||
    !/^[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/i.test(email) ||
    email.includes("..")
  )
    throw new ValidationError("Invalid email.");
  return email;
}
export interface ContactFormData {
  name: string;
  email: string;
  subject?: string;
  message: string;
  token?: string;
}
function plain(value: string, max: number, multiline = false): string {
  const text = value.normalize("NFC").trim();
  const controls = multiline
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  if (
    !text ||
    text.length > max ||
    controls.test(text) ||
    /[\u202a-\u202e\u2066-\u2069]/.test(text)
  )
    throw new ValidationError("Invalid field.");
  return text;
}
export function sanitizeContactForm(data: ContactFormData): ContactFormData {
  // Keep legitimate code/text intact. It is never executed or inserted as HTML;
  // every user field is escaped at the email HTML boundary by the handler.
  return {
    name: plain(data.name, 100),
    email: sanitizeEmail(data.email),
    subject: plain(data.subject ?? "", 200),
    message: plain(data.message, 5000, true),
    token: data.token,
  };
}
