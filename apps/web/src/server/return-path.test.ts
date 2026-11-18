import { describe, expect, it } from "vitest";
import { safeReturnPath } from "./return-path";

describe("where to go after signing in", () => {
  it("accepts a path on this site", () => {
    expect(safeReturnPath("/checkout")).toBe("/checkout");
    expect(safeReturnPath("/p/leather-tote?color=brown")).toBe("/p/leather-tote?color=brown");
  });

  it("refuses other sites, however they are disguised", () => {
    for (const trick of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "/\n/evil.example",
      "/ /evil.example",
      "javascript:alert(1)",
      "/admin",
      "/api/v1/admin/me",
      `/${"a".repeat(400)}`,
    ]) {
      expect(safeReturnPath(trick), trick).toBe("/account");
    }
    expect(safeReturnPath(undefined, "/")).toBe("/");
  });
});
