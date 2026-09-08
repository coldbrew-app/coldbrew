import { env } from "./env.js";

export function parseAdminEmails(value: string) {
  return [
    ...new Set(
      value
        .split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

const adminEmails = new Set(parseAdminEmails(env.ADMIN_EMAILS));

export function isAdminEmail(email: string) {
  return adminEmails.has(email.trim().toLowerCase());
}
