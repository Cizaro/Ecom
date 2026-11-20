/**
 * Points the automated tests' email at the local test inbox (Mailpit),
 * whatever .env says: tests send to made-up addresses all day and must
 * never use a real email account (decision D118). Mailpit on localhost:1025
 * is where the browser tests read their emails.
 */
export function useTestEmail(env: Record<string, string | undefined>): void {
  env.EMAIL_PROVIDER = "smtp";
  env.SMTP_HOST = "localhost";
  env.SMTP_PORT = "1025";
  env.EMAIL_FROM = "store@example.test";
  // Empty rather than removed: loading .env later never fills a variable
  // that is already set, so the real account cannot come back.
  env.SMTP_USER = "";
  env.SMTP_PASSWORD = "";
}
