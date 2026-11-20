import { describe, expect, it } from "vitest";
import { areaOf, platformRewrite, requestHostName } from "./area";

describe("areaOf", () => {
  it("puts the admin and API in the admin area, the rest in the shop", () => {
    expect(areaOf("/admin/team")).toBe("admin");
    expect(areaOf("/api/health")).toBe("admin");
    expect(areaOf("/products")).toBe("shop");
  });
});

describe("requestHostName", () => {
  it("uses the Host header, lowercase and without the port", () => {
    expect(requestHostName("Platform.Localhost:3000", null)).toBe("platform.localhost");
  });

  it("trusts X-Forwarded-Host only for a request from this machine", () => {
    expect(requestHostName("localhost:3000", "platform.localhost:3000")).toBe("platform.localhost");
    expect(requestHostName("shop.example.com", "platform.example.com")).toBe("shop.example.com");
  });

  it("ignores IPv6 literals and empty hosts", () => {
    expect(requestHostName("[::1]:3000", null)).toBeNull();
    expect(requestHostName("", null)).toBeNull();
  });
});

describe("platformRewrite", () => {
  it("sends the platform host's pages to the platform site", () => {
    expect(platformRewrite("/")).toBe("/platform-site");
    expect(platformRewrite("/signup")).toBe("/platform-site/signup");
  });

  it("leaves the shared admin, API and Next.js files alone", () => {
    expect(platformRewrite("/admin")).toBeNull();
    expect(platformRewrite("/admin/sign-in")).toBeNull();
    expect(platformRewrite("/api/health")).toBeNull();
    expect(platformRewrite("/_next/static/x.js")).toBeNull();
  });
});
