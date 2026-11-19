import { describe, expect, it } from "vitest";
import { checkLaunchSettings } from "../platform/launch-check";
import { PAGE_SLUGS, pageBlocks, pageTemplate, unfilledBlanks } from "./store-pages";

describe("policy page templates", () => {
  it("leave every store decision as a blank, so nothing is invented", () => {
    for (const slug of PAGE_SLUGS) {
      const text = pageTemplate(slug, "Cedar Bags");
      expect(text, slug).toContain("Cedar Bags");
      expect(unfilledBlanks(text).length, slug).toBeGreaterThan(0);
    }
    expect(pageTemplate("returns", "Shop")).toContain("[NUMBER OF DAYS]");
  });

  it("find blanks but not ordinary brackets", () => {
    expect(unfilledBlanks("Within [NUMBER OF DAYS] days (see [link]). [NUMBER OF DAYS]")).toEqual([
      "[NUMBER OF DAYS]",
    ]);
    expect(unfilledBlanks("Within 14 days.")).toEqual([]);
  });

  it("become headings, paragraphs and lists, never HTML", () => {
    expect(
      pageBlocks("Intro line\ncontinues.\n\n## Refunds\n- one\n- two\n\n<script>x</script>"),
    ).toEqual([
      { type: "paragraph", text: "Intro line continues." },
      { type: "heading", text: "Refunds" },
      { type: "list", items: ["one", "two"] },
      { type: "paragraph", text: "<script>x</script>" },
    ]);
  });
});

describe("launch check of the server settings", () => {
  const live = {
    NODE_ENV: "production" as const,
    APP_URL: "https://shop.example.lb",
    EMAIL_PROVIDER: "smtp" as const,
    EMAIL_FROM: "orders@cedarbags.lb",
    PAYMENT_PROVIDER: "none" as const,
    ALLOW_SEARCH_INDEXING: true,
    ALLOW_MOCK_PAYMENTS_IN_PRODUCTION: false,
    IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS: false,
    S3_PUBLIC_URL: "https://media.cedarbags.lb",
    AI_PROVIDER: "anthropic" as const,
    AI_PAUSED: false,
    RATE_LIMIT_SCALE: 1,
    META_GRAPH_MODE: "live" as "live" | "fake",
    META_APP_ID: "1414532210811508" as string | undefined,
    TRUST_PROXY_HOPS: 1,
  };

  it("passes a live configuration", () => {
    expect(checkLaunchSettings(live).filter((f) => f.status !== "pass")).toEqual([]);
  });

  it("fails what would hurt real customers, and warns about the rest", () => {
    const results = checkLaunchSettings({
      ...live,
      NODE_ENV: "development",
      APP_URL: "http://localhost:3000",
      EMAIL_PROVIDER: "console",
      EMAIL_FROM: "store@example.com",
      PAYMENT_PROVIDER: "mock",
      ALLOW_SEARCH_INDEXING: false,
      IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS: true,
    });
    const failed = results.filter((f) => f.status === "fail").map((f) => f.label);
    expect(failed).toEqual(
      expect.arrayContaining([
        "Running mode",
        "Secure address",
        "Public address",
        "Email sending",
        "Sender address",
        "Payments",
        "Test switch",
      ]),
    );
    expect(results.find((f) => f.label === "Search engines")?.status).toBe("warn");
  });

  it("fails relaxed visitor limits and warns when visitor addresses cannot be told apart", () => {
    const find = (env: Partial<typeof live>, label: string) =>
      checkLaunchSettings({ ...live, ...env }).filter((f) => f.label === label);
    expect(find({ RATE_LIMIT_SCALE: 100 }, "Test switch")[0]?.detail).toMatch(/RATE_LIMIT_SCALE/);
    expect(find({ META_GRAPH_MODE: "fake" }, "Test switch")[0]?.detail).toMatch(/META_GRAPH_MODE/);
    expect(find({ META_APP_ID: undefined }, "Instagram and Facebook")[0]?.status).toBe("warn");
    expect(find({ TRUST_PROXY_HOPS: 0 }, "Visitor addresses")[0]?.status).toBe("warn");
    expect(find({}, "Visitor addresses")[0]?.status).toBe("pass");
  });

  it("warns when AI is the test stand-in or paused", () => {
    const ai = (env: Partial<typeof live>) =>
      checkLaunchSettings({ ...live, ...env }).find((f) => f.label === "AI");
    expect(ai({})?.status).toBe("pass");
    expect(ai({ AI_PROVIDER: "mock" as never })?.status).toBe("warn");
    expect(ai({ AI_PAUSED: true })?.detail).toMatch(/paused/);
  });
});
