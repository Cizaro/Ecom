import { describe, expect, it } from "vitest";
import {
  BRANDING_PRESETS,
  contrastRatio,
  DEFAULT_BRANDING,
  normalizeHex,
  parseBranding,
  readableOn,
  themeVariables,
} from "./branding";

describe("store colours", () => {
  it("are read in the usual ways people write them", () => {
    expect(normalizeHex("#1C1917")).toBe("#1c1917");
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(normalizeHex(" #0F766E ")).toBe("#0f766e");
    for (const bad of ["red", "#12345", "#gggggg", "", 5, null]) {
      expect(normalizeHex(bad)).toBeNull();
    }
  });

  it("get button text that stays readable, whatever colour a store picks", () => {
    expect(readableOn("#1c1917")).toBe("#ffffff");
    expect(readableOn("#fde68a")).toBe("#1c1917");
    for (const colour of ["#000000", "#ffffff", "#ff0000", "#00ff00", "#0000ff", "#777777"]) {
      expect(contrastRatio(colour, readableOn(colour)), colour).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("a store's look", () => {
  it("falls back to the default for anything missing or odd in what is stored", () => {
    expect(parseBranding(null)).toEqual(DEFAULT_BRANDING);
    expect(
      parseBranding({ brandColor: "javascript:alert(1)", corners: "wavy", font: 7, tagline: 3 }),
    ).toEqual(DEFAULT_BRANDING);
    expect(parseBranding({ brandColor: "#166534", corners: "round" })).toMatchObject({
      brandColor: "#166534",
      corners: "round",
      accentColor: DEFAULT_BRANDING.accentColor,
    });
  });

  it("becomes design tokens made only of safe values", () => {
    const theme = themeVariables(
      parseBranding({ brandColor: "#166534", corners: "round", font: "serif" }),
    );
    expect(theme["--color-brand"]).toBe("#166534");
    expect(theme["--color-brand-contrast"]).toBe("#ffffff");
    expect(theme["--radius-card"]).toBe("1.25rem");
    expect(theme["--font-sans"]).toContain("Georgia");
    // A pale brand keeps a visible focus ring.
    expect(themeVariables(parseBranding({ brandColor: "#fde68a" }))["--color-focus"]).toBe(
      "#1c1917",
    );
    // Nothing a store types reaches the page except colours, sizes and system fonts.
    for (const value of Object.values(theme)) {
      expect(value).not.toMatch(/url\(|;|<|javascript/i);
    }
  });

  it("has ready-made looks whose accents are readable on white", () => {
    for (const preset of BRANDING_PRESETS) {
      expect(
        contrastRatio(preset.branding.accentColor!, "#ffffff"),
        preset.key,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
});
