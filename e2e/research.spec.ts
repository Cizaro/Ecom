import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { exact, signIn } from "./catalog-helpers";
import { roleEmail } from "./users";

// Milestone 7.2: a marketer lists a competitor, notes what they saw (typed by
// hand, with the source and date), and drafts AI ideas from it (the built-in
// test stand-in, no outside calls); each idea cites the observation.

test("a marketer notes a competitor's price and keeps an AI idea that cites it", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const tag = `${testInfo.project.name}${randomUUID().slice(0, 6)}`;
  const name = `Bag House ${tag}`;
  const seen = `Similar tote for $65 ${tag}`;

  await signIn(page, roleEmail("marketer"));
  await page.goto("/admin/research");
  const add = page.getByTestId("competitor-form");
  await add.getByLabel("Name", exact).fill(name);
  await add.getByLabel("Website").fill("baghouse.example");
  await add.getByLabel("Instagram").fill("@baghouse");
  await add.getByRole("button", { name: "Add competitor" }).click();
  await expect(page).toHaveURL(/\/admin\/research\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("link", { name: "Instagram @baghouse" })).toHaveAttribute(
    "href",
    "https://www.instagram.com/baghouse/",
  );

  const form = page.getByTestId("observation-form");
  await form.getByLabel("What").selectOption("price");
  await form.getByLabel("In a few words").fill(seen);
  await form.getByLabel(/Price seen/).fill("65");
  await form.getByLabel("Link to where you saw it").fill("https://baghouse.example/tote");
  await form.getByRole("button", { name: "Add observation" }).click();
  await expect(form.getByTestId("form-notice")).toHaveText("Observation added.");
  const observation = page.getByTestId("observation").filter({ hasText: seen });
  await expect(observation.getByTestId("price-comparison")).toContainText("Their price $65.00");
  await expect(observation.getByRole("link", { name: "source" })).toHaveAttribute(
    "href",
    "https://baghouse.example/tote",
  );

  // A wrong address is refused, not stored.
  await form.getByLabel("In a few words").fill("Bad link");
  await form.getByLabel("Link to where you saw it").fill("javascript:alert(1)");
  await form.getByRole("button", { name: "Add observation" }).click();
  await expect(form.getByRole("alert")).toContainText("web address");

  // Ideas drafted from the observations, labelled as suggestions, citing them.
  await page.goto("/admin/research/ideas");
  await page.getByTestId("ideas-form").getByRole("button", { name: "Draft ideas with AI" }).click();
  await expect(page.getByTestId("ideas-form").getByTestId("form-notice")).toContainText(
    "suggestions",
  );
  const idea = page.getByTestId("idea").filter({ hasText: seen }).first();
  await expect(idea).toContainText("AI suggestion");
  await expect(idea).toContainText(`Based on: ${name}`);
  const mine = page.getByTestId("idea").filter({ hasText: seen });
  const before = await mine.count();
  await idea.getByTestId("idea-keep").getByRole("button", { name: "Keep" }).click();
  // Kept ideas leave the list to review.
  await expect(mine).toHaveCount(before - 1);
  await page.goto("/admin/research/ideas?status=accepted");
  await expect(page.getByTestId("idea").filter({ hasText: seen }).first()).toBeVisible();
});
