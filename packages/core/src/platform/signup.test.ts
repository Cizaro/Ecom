import { describe, expect, it } from "vitest";
import { BRANDING_PRESETS } from "../tenancy/branding";
import { SHOP_TEMPLATES, shopNameProblem } from "./signup";

describe("shopNameProblem", () => {
  it("accepts simple shop addresses", () => {
    expect(shopNameProblem("tamara")).toBeNull();
    expect(shopNameProblem("lina-bags")).toBeNull();
    expect(shopNameProblem("shop24")).toBeNull();
  });

  it("refuses badly formed addresses", () => {
    for (const bad of [
      "ab",
      "-tamara",
      "tamara-",
      "ta--mara",
      "Tamara",
      "tam ara",
      "a".repeat(31),
    ]) {
      expect(shopNameProblem(bad), bad).not.toBeNull();
    }
  });

  it("refuses addresses the platform keeps for itself", () => {
    for (const reserved of ["www", "admin", "api", "platform", "mail", "support"]) {
      expect(shopNameProblem(reserved)).toMatch(/reserved/);
    }
  });
});

describe("SHOP_TEMPLATES", () => {
  it("offers one template per ready-made look, with full branding", () => {
    expect(SHOP_TEMPLATES.map((t) => t.key).sort()).toEqual(
      BRANDING_PRESETS.map((p) => p.key).sort(),
    );
    for (const template of SHOP_TEMPLATES) {
      expect(template.branding.brandColor).toMatch(/^#[0-9a-f]{6}$/);
      expect(template.description.length).toBeGreaterThan(10);
    }
  });
});
