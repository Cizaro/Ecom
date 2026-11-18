import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { exact, signIn } from "./catalog-helpers";
import { linkTo, waitForEmail } from "./mail";
import { roleEmail } from "./users";

// Support conversations: a guest writes from the contact page and gets a
// private link by email; staff reply (emailed) and leave an internal note
// (never shown to the shopper); the guest answers from the link.

test("a guest writes in, staff reply with a private note, and the guest answers", async ({
  page,
  browser,
  request,
}, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const email = `support-${tag}@example.test`;
  const subject = `Gift wrapping ${tag}`;

  // --- The guest writes from the contact page --------------------------------------
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto("/");
  await guest.getByTestId("contact-link").click();
  const form = guest.getByTestId("contact-form");
  await form.getByLabel("Your name").fill("Lea Hanna");
  await form.getByLabel("Email", exact).fill(email);
  await form.getByLabel("Subject").fill(subject);
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(form.getByTestId("account-error")).toContainText("Write your message");
  await form.getByLabel("Message").fill("Can you wrap the tote as a gift?");
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(guest).toHaveURL(/\/support\/[0-9a-f-]{36}\?key=/);
  await expect(guest.getByTestId("conversation-sent")).toBeVisible();
  const received = await waitForEmail(request, email, "We received your message");
  // The email's links use the app's configured address; the tests run on another port.
  const emailed = new URL(linkTo(received, "/support/"));
  const link = `${emailed.pathname}${emailed.search}`;

  // --- Staff note and reply ------------------------------------------------------------
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin");
  await page.getByRole("link", { name: "Inbox" }).first().click();
  await page.getByRole("link", { name: subject }).click();
  const reply = page.getByTestId("staff-reply-form");
  await reply.getByLabel("Message").fill(`Wrapping paper is out of stock ${tag}`);
  await reply.getByLabel(/Internal note/).check();
  await reply.getByRole("button", { name: "Send" }).click();
  await expect(reply.getByTestId("form-notice")).toHaveText("Note added (staff only).");
  await expect(page.getByTestId("staff-note")).toContainText("out of stock");
  await reply.getByLabel("Message").fill("Yes, we can wrap it for free.");
  await reply.getByLabel(/Internal note/).uncheck();
  await reply.getByRole("button", { name: "Send" }).click();
  await expect(reply.getByTestId("form-notice")).toHaveText("Reply sent.");
  await expect(page.getByTestId("conversation-status")).toContainText("Waiting for customer");

  // --- The guest gets the reply by email, never the note -------------------------------
  const replyMail = await waitForEmail(request, email, `Re: ${subject}`);
  expect(replyMail).toContain("Yes, we can wrap it for free.");
  expect(replyMail).not.toContain("out of stock");
  await guest.goto(link);
  const messages = guest.getByTestId("conversation-message");
  await expect(messages).toHaveCount(2);
  await expect(messages.nth(1)).toContainText("Yes, we can wrap it for free.");
  await expect(guest.getByText(`Wrapping paper is out of stock ${tag}`)).toHaveCount(0);
  const answer = guest.getByTestId("conversation-reply");
  await answer.getByLabel("Your reply").fill("Wonderful, thank you!");
  await answer.getByRole("button", { name: "Send" }).click();
  await expect(answer.getByTestId("account-notice")).toContainText("Sent");

  // Without the key the conversation does not exist.
  await guest.goto(link.replace(/\?key=.*/, ""));
  await expect(guest.getByTestId("shop-not-found")).toBeVisible();
  await guestContext.close();

  // Back with the store.
  await page.reload();
  await expect(page.getByTestId("conversation-status")).toContainText("To answer");
  await expect(page.getByTestId("staff-message").last()).toContainText("Wonderful, thank you!");
});

test("staff see a customer's timeline and add a note", async ({ page }) => {
  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/customers");
  await page.getByTestId("customer-email").first().click();
  await expect(page.getByTestId("customer-timeline")).toBeVisible();
  const note = `Prefers calls after 5pm ${randomUUID().slice(0, 6)}`;
  const form = page.getByTestId("customer-note-form");
  await form.getByLabel("Note").fill(note);
  await form.getByRole("button", { name: "Add note" }).click();
  await expect(form.getByTestId("form-notice")).toHaveText("Note added.");
  await expect(page.getByTestId("customer-timeline").getByText(note)).toBeVisible();
});

// Milestone 5.3: an AI draft in the inbox, which staff edit and send themselves.
test("staff draft a reply with AI, change it and send it", async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const subject = `Opening hours ${tag}`;

  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  await guest.goto("/contact");
  const form = guest.getByTestId("contact-form");
  await form.getByLabel("Your name").fill("Rami Khoury");
  await form.getByLabel("Email", exact).fill(`ai-draft-${tag}@example.test`);
  await form.getByLabel("Subject").fill(subject);
  await form.getByLabel("Message").fill(`Do you sell gift cards? ${tag}`);
  await form.getByRole("button", { name: "Send message" }).click();
  await expect(guest).toHaveURL(/\/support\/[0-9a-f-]{36}\?key=/);
  const link = guest.url();

  await signIn(page, roleEmail("store_owner"));
  await page.goto("/admin/inbox");
  await page.getByRole("link", { name: subject }).click();
  // Nothing is drafted until asked (the background labelling runs in the worker).
  await page
    .getByTestId("support-draft-form")
    .getByRole("button", { name: "Draft a reply with AI" })
    .click();
  const reply = page.getByTestId("staff-reply-form");
  const box = reply.getByLabel("Message");
  // The draft is in the reply box, with the shop facts it used (the stand-in
  // AI quotes the first fact it is given).
  await expect(box).not.toHaveValue("");
  await expect(page.getByTestId("support-draft-facts")).toBeVisible();
  await box.fill("Not yet, but we will tell you as soon as we do.");
  await reply.getByRole("button", { name: "Send" }).click();
  await expect(reply.getByTestId("form-notice")).toHaveText("Reply sent.");
  await expect(page.getByTestId("support-dismiss-form")).toHaveCount(0);

  await guest.goto(link);
  await expect(guest.getByTestId("conversation-message").nth(1)).toContainText(
    "Not yet, but we will tell you",
  );
  await guestContext.close();
});
