import { describe, expect, it } from "vitest";
import { authorNameFrom } from "./reviews";

describe("the name shown with a review", () => {
  it("is the first name and the last name's initial, never the full name", () => {
    expect(authorNameFrom("Maya Khoury")).toBe("Maya K.");
    expect(authorNameFrom("  rami   abou haddad ")).toBe("rami H.");
    expect(authorNameFrom("Sara")).toBe("Sara");
    expect(authorNameFrom("   ")).toBe("Customer");
  });
});
