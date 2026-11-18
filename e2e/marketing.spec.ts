import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Milestone 7.1: a marketer plans a campaign, ties a post to it, makes a
// tracking link on the post, a visitor follows the short link, and the click
// shows on the post, the links page and the campaign. Then a segment.

test("a marketer plans a campaign and sees which post's link brought visitors", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const campaignName = `Summer totes ${tag}`;
  const postTitle = `Beach reel ${tag}`;
  const year = new Date().getUTCFullYear();
  const start = `${year}-06-01`;

  await signIn(page, roleEmail("marketer"));
  await page.goto("/admin/marketing/campaigns/new");
  const form = page.getByTestId("campaign-form");
  await form.getByLabel("Campaign name").fill(campaignName);
  await form.getByLabel("Goal").selectOption("sales");
  await form.getByLabel("Starts").fill(start);
  await form.getByLabel("Ends").fill(`${year}-06-30`);
  await form.getByLabel("Instagram").check();
  await form.getByLabel("TikTok").check();
  await form.getByLabel("Who it is for").fill("Women 20 to 35 in Beirut");
  await form.getByLabel("Key message").fill("Light totes for the beach");
  await form.getByLabel(/Planned budget/).fill("150");
  await form.getByRole("button", { name: "Save campaign" }).click();
  await expect(page).toHaveURL(/\/admin\/marketing\/campaigns\/[0-9a-f-]{36}$/);
  const campaignUrl = page.url();
  await expect(page.getByTestId("campaign-results")).toContainText("No code linked");

  // The plan shows it in June.
  await page.goto(`/admin/marketing/campaigns?year=${year}`);
  const row = page.getByTestId("campaign-row").filter({ hasText: campaignName });
  await expect(row).toContainText("Instagram, TikTok");
  await expect(row).toContainText("budget $150.00");

  // A post in the campaign, with a tracking link to the home page.
  await page.goto("/admin/marketing/posts/new");
  const post = page.getByTestId("post-form");
  await post.getByLabel("Name (for your team)").fill(postTitle);
  await post.getByLabel("Kind").selectOption("reel");
  await post.getByLabel("Campaign").selectOption({ label: campaignName });
  await post.getByRole("button", { name: "Save draft" }).click();
  await expect(page).toHaveURL(/\/admin\/marketing\/posts\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: campaignName })).toBeVisible();

  const linkForm = page.getByTestId("link-form");
  await linkForm.getByLabel("Name (for your team)").fill(`Reel link ${tag}`);
  await linkForm.getByLabel("Page of your shop").fill("/products");
  await linkForm.getByLabel("Placement").fill("reel");
  await linkForm.getByRole("button", { name: "Make tracking link" }).click();
  await expect(linkForm.getByTestId("form-notice")).toContainText("Tracking link made");
  const shortLink = (await page.getByTestId("short-link").first().textContent()) ?? "";
  const code = /\/go\/([a-z0-9]+)$/.exec(shortLink.trim())?.[1];
  expect(code, shortLink).toBeTruthy();

  // Links can only go to the shop itself.
  await linkForm.getByLabel("Name (for your team)").fill("Elsewhere");
  await linkForm.getByLabel("Page of your shop").fill("https://example.com/");
  await linkForm.getByRole("button", { name: "Make tracking link" }).click();
  await expect(linkForm.getByRole("alert")).toContainText("own shop");

  // A visitor (not signed in) follows the short link and lands on the page, tagged.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();
  await visitor.goto(`/go/${code}`);
  await expect(visitor).toHaveURL(
    /\/products\?utm_source=instagram&utm_medium=reel&utm_campaign=summer-totes-/,
  );
  await visitorContext.close();

  await page.reload();
  await expect(
    page
      .getByTestId("tracking-link")
      .filter({ hasText: `Reel link ${tag}` })
      .getByTestId("link-clicks"),
  ).toContainText("1 click");
  await page.goto(campaignUrl);
  await expect(page.getByTestId("campaign-posts")).toContainText(postTitle);
  await expect(page.getByTestId("campaign-results")).toContainText("1");
  await page.goto("/admin/marketing/links");
  await expect(
    page.getByTestId("tracking-link").filter({ hasText: `Reel link ${tag}` }),
  ).toContainText(`Campaign ${campaignName}`);

  // A segment of customers, counted now; the marketer sees members but cannot export.
  await page.goto("/admin/marketing/segments");
  const segment = page.getByTestId("segment-form");
  await segment.getByLabel("Segment name").fill(`Everyone ${tag}`);
  await segment.getByRole("button", { name: "Save segment" }).click();
  await expect(page).toHaveURL(/\/admin\/marketing\/segments\/[0-9a-f-]{36}$/);
  await expect(page.getByTestId("segment-counts")).toContainText("Customers now");
  await expect(page.getByRole("link", { name: /Export emails/ })).toHaveCount(0);
  await segment.getByLabel("Segment name").fill(`Everyone ${tag}`);
  await expect(page.getByLabel("At least this many orders", exact)).toBeVisible();
});
