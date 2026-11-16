import { expect, type APIRequestContext } from "@playwright/test";

// Reading the emails the app sends, from the local Mailpit inbox that catches
// all outgoing mail in development and tests.

const MAILPIT = "http://localhost:8025";

/**
 * Waits for the newest email to an address whose text contains `containing`
 * (a subject word or a link path), and returns its text.
 */
export async function waitForEmail(
  request: APIRequestContext,
  to: string,
  containing: string,
): Promise<string> {
  let found = "";
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/api/v1/search`, {
          params: { query: `to:${to}` },
        });
        const { messages } = (await search.json()) as { messages: { ID: string }[] };
        for (const summary of messages) {
          const message = await request.get(`${MAILPIT}/api/v1/message/${summary.ID}`);
          const { Text, Subject } = (await message.json()) as { Text: string; Subject: string };
          if (Text.includes(containing) || Subject.includes(containing)) {
            found = Text;
            return true;
          }
        }
        return false;
      },
      { timeout: 15_000 },
    )
    .toBe(true);
  return found;
}

/** The first link in an email's text that goes to the given path. */
export function linkTo(text: string, path: string): string {
  const match = new RegExp(`https?://[^\\s]+${path.replace(/[/?]/g, "\\$&")}[^\\s]*`).exec(text);
  if (!match) throw new Error(`no link to ${path} in the email`);
  return match[0];
}
