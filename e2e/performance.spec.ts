/// <reference lib="dom" />
import { expect, test } from "@playwright/test";

// Page weight and layout stability on a phone-sized screen. These are the
// parts of performance that do not depend on how fast the test computer is,
// so they can be held to a budget: how much script and style a page sends,
// and whether the page jumps while it loads. Timings (how long things take)
// are recorded in docs/PERFORMANCE.md by hand instead.

const BUDGET = {
  /** Compressed script sent for one page view, in kilobytes. */
  scriptKb: 200,
  styleKb: 20,
  /**
   * The page's own HTML, compressed. Generous on purpose: the test store
   * gains a category in the navigation on every local test run, which a real
   * store does not.
   */
  documentKb: 150,
  /** Cumulative Layout Shift. Under 0.1 counts as "good". */
  layoutShift: 0.1,
};

interface Measured {
  scriptKb: number;
  styleKb: number;
  documentKb: number;
  /** Pictures fetched. Their size cannot be read here: they come from the storage address. */
  images: number;
  layoutShift: number;
}

// eslint-disable-next-line no-empty-pattern -- Playwright requires a destructured first argument.
test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile", "measured on the phone profile only");
});

for (const path of ["/", "/products"]) {
  test(`${path} stays within the page-weight and layout budgets`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    // Scroll through the page so lazily loaded pictures arrive and any shift they cause is counted.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) {
        window.scrollTo(0, y);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      window.scrollTo(0, 0);
    });
    await page.waitForLoadState("networkidle");

    const measured: Measured = await page.evaluate(async () => {
      const kb = (bytes: number) => Math.round(bytes / 102.4) / 10;
      const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const sum = (wanted: (entry: PerformanceResourceTiming) => boolean) =>
        resources.filter(wanted).reduce((total, entry) => total + entry.transferSize, 0);
      const isImage = (entry: PerformanceResourceTiming) => entry.initiatorType === "img";
      const [navigation] = performance.getEntriesByType(
        "navigation",
      ) as PerformanceNavigationTiming[];
      const layoutShift = await new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries() as (PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
          })[]) {
            if (!entry.hadRecentInput) total += entry.value;
          }
        }).observe({ type: "layout-shift", buffered: true });
        setTimeout(() => resolve(Math.round(total * 1000) / 1000), 300);
      });
      return {
        scriptKb: kb(sum((entry) => entry.name.endsWith(".js"))),
        styleKb: kb(sum((entry) => entry.name.endsWith(".css"))),
        documentKb: kb(navigation?.transferSize ?? 0),
        images: resources.filter(isImage).length,
        layoutShift,
      };
    });

    // Shown in the test report, for copying into docs/PERFORMANCE.md.
    test.info().annotations.push({ type: "measured", description: JSON.stringify(measured) });
    console.log(`performance ${path} ${JSON.stringify(measured)}`);

    expect(measured.scriptKb, "script sent").toBeLessThanOrEqual(BUDGET.scriptKb);
    expect(measured.styleKb, "styles sent").toBeLessThanOrEqual(BUDGET.styleKb);
    expect(measured.documentKb, "HTML sent").toBeLessThanOrEqual(BUDGET.documentKb);
    expect(measured.layoutShift, "layout shift").toBeLessThanOrEqual(BUDGET.layoutShift);

    // Every picture declares its size, so the page does not jump when it arrives.
    const unsized = await page
      .locator("img")
      .evaluateAll((images) => images.filter((image) => !image.getAttribute("width")).length);
    expect(unsized).toBe(0);
  });
}
