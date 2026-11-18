import { describe, expect, it } from "vitest";
import { storePath, trackedUrl, utmTag } from "./links";

const hosts = ["shop.example", "localhost"];

describe("storePath", () => {
  it("accepts a path or a full address on the store's own domain", () => {
    expect(storePath("/p/leather-tote", hosts)).toBe("/p/leather-tote");
    expect(storePath("https://shop.example/c/bags?sort=new", hosts)).toBe("/c/bags?sort=new");
    expect(storePath("  /  ", hosts)).toBe("/");
  });

  it("refuses other sites and tricks that leave the store", () => {
    for (const bad of [
      "https://evil.example/p/x",
      "//evil.example/x",
      "/\\evil.example",
      "javascript:alert(1)",
      "p/no-slash",
      "/admin/orders",
      "/api/v1/admin/me",
      "/go/abc123",
      "/p/with space",
      "",
    ]) {
      expect(storePath(bad, hosts), bad).toBeNull();
    }
  });

  it("drops UTM tags typed into the address (the link adds its own)", () => {
    expect(storePath("/p/tote?utm_source=x&color=black&UTM_medium=y", hosts)).toBe(
      "/p/tote?color=black",
    );
  });
});

describe("utmTag", () => {
  it("makes lower-case tags without spaces", () => {
    expect(utmTag("Summer Sale 2026")).toBe("summer-sale-2026");
    expect(utmTag("  Instagram / Bio ")).toBe("instagram-bio");
    expect(utmTag("عرض")).toBe("");
  });
});

describe("trackedUrl", () => {
  it("adds the tags to the page's address", () => {
    const link = {
      destinationPath: "/c/bags?sort=new",
      source: "instagram",
      medium: "story",
      utmCampaign: "summer-sale",
      content: "reel-1",
    };
    expect(trackedUrl(link, "https://shop.example")).toBe(
      "https://shop.example/c/bags?sort=new&utm_source=instagram&utm_medium=story&utm_campaign=summer-sale&utm_content=reel-1",
    );
    expect(trackedUrl({ ...link, destinationPath: "/", content: "" }, "")).toBe(
      "/?utm_source=instagram&utm_medium=story&utm_campaign=summer-sale",
    );
  });
});
