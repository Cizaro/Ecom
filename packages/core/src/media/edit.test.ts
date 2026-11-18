import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  describeEdit,
  editImage,
  EditError,
  parseEditOptions,
  removePlainBackground,
  type EditOptions,
} from "./edit";

const base: EditOptions = parseEditOptions({});

/** A red bag (rectangle) in the middle of a plain off-white photo. */
async function productPhoto(width = 600, height = 400) {
  const bag = await sharp({
    create: { width: 200, height: 160, channels: 3, background: { r: 190, g: 30, b: 40 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width, height, channels: 3, background: { r: 246, g: 244, b: 240 } },
  })
    .composite([{ input: bag, gravity: "centre" }])
    .jpeg({ quality: 95 })
    .toBuffer();
}

async function pixel(image: Uint8Array, x: number, y: number) {
  const { data, info } = await sharp(image)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * 4;
  return { r: data[i]!, g: data[i + 1]!, b: data[i + 2]!, a: data[i + 3]! };
}

describe("parseEditOptions", () => {
  it("has safe defaults: a square, cropped to fill, nothing else changed", () => {
    expect(base).toEqual({
      size: "instagram_square",
      fit: "fill",
      position: "smart",
      background: "white",
      removeBackground: false,
      autoLight: false,
      brightness: 0,
      saturation: 0,
      sharpen: false,
    });
  });

  it("refuses unknown values and changes beyond 10%", () => {
    expect(() => parseEditOptions({ size: "billboard" })).toThrow(EditError);
    expect(() => parseEditOptions({ fit: "stretch" })).toThrow(EditError);
    expect(() => parseEditOptions({ background: "red" })).toThrow(EditError);
    expect(() => parseEditOptions({ brightness: "30" })).toThrow(/10%/);
    expect(() => parseEditOptions({ saturation: "-50" })).toThrow(/10%/);
    expect(() => parseEditOptions({ brightness: "7" })).toThrow(/10%/);
  });

  it("refuses a blurred background behind a removed one", () => {
    expect(() => parseEditOptions({ removeBackground: "on", background: "blur" })).toThrow(
      /blurred/,
    );
  });
});

describe("editImage", () => {
  it("makes each platform size exactly", async () => {
    const photo = await productPhoto();
    for (const [size, w, h] of [
      ["instagram_square", 1080, 1080],
      ["instagram_portrait", 1080, 1350],
      ["story", 1080, 1920],
      ["facebook_landscape", 1200, 630],
    ] as const) {
      const out = await editImage(photo, { ...base, size });
      expect([out.width, out.height]).toEqual([w, h]);
      const meta = await sharp(out.body).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([w, h, "jpeg"]);
      expect(out.enlarged).toBe(true);
    }
  });

  it("keeps the original size when asked, without enlarging", async () => {
    const out = await editImage(await productPhoto(), { ...base, size: "original" });
    expect([out.width, out.height, out.enlarged]).toEqual([600, 400, false]);
  });

  it("fits the whole photo on the chosen background", async () => {
    const out = await editImage(await productPhoto(), {
      ...base,
      size: "story",
      fit: "whole",
      background: "black",
    });
    // A wide photo in a tall frame: black above and below.
    expect(await pixel(out.body, 540, 20)).toMatchObject({ r: 0, g: 0, b: 0 });
    const middle = await pixel(out.body, 540, 960);
    expect(middle.r).toBeGreaterThan(150);
    expect(middle.g).toBeLessThan(80);
  });

  it("removes a plain background and keeps the product", async () => {
    const out = await editImage(await productPhoto(), {
      ...base,
      size: "instagram_square",
      fit: "whole",
      background: "transparent",
      removeBackground: true,
    });
    expect(out.mimeType).toBe("image/png");
    expect(out.removedShare).toBeGreaterThan(0.8);
    expect((await pixel(out.body, 10, 540)).a).toBe(0);
    expect((await pixel(out.body, 540, 540)).a).toBe(255);
  });

  it("puts the product on white after removing the background", async () => {
    const out = await editImage(await productPhoto(), {
      ...base,
      removeBackground: true,
      background: "white",
    });
    expect(out.mimeType).toBe("image/jpeg");
    const corner = await pixel(out.body, 5, 5);
    expect(corner.r).toBeGreaterThan(250);
    expect(corner.b).toBeGreaterThan(250);
  });

  it("changes brightness only within the small step", async () => {
    const photo = await productPhoto();
    const before = await pixel(
      (await editImage(photo, { ...base, size: "original" })).body,
      300,
      200,
    );
    const after = await pixel(
      (await editImage(photo, { ...base, size: "original", brightness: 10 })).body,
      300,
      200,
    );
    expect(after.r).toBeGreaterThan(before.r);
    expect(after.r).toBeLessThanOrEqual(Math.ceil(before.r * 1.15));
  });
});

describe("removePlainBackground", () => {
  it("refuses a busy background", () => {
    const width = 50;
    const height = 50;
    const rgba = new Uint8Array(width * height * 4);
    for (let p = 0; p < width * height; p++) {
      rgba[p * 4] = (p * 97) % 256;
      rgba[p * 4 + 1] = (p * 31) % 256;
      rgba[p * 4 + 2] = (p * 57) % 256;
      rgba[p * 4 + 3] = 255;
    }
    expect(() => removePlainBackground(rgba, width, height)).toThrow(/not plain enough/);
  });

  it("refuses a photo that is all background", () => {
    const rgba = new Uint8Array(40 * 40 * 4).fill(250);
    expect(() => removePlainBackground(rgba, 40, 40)).toThrow(/told apart/);
  });
});

describe("describeEdit", () => {
  it("says what was done in words", () => {
    const text = describeEdit(
      {
        ...base,
        size: "story",
        fit: "whole",
        background: "white",
        removeBackground: true,
        autoLight: true,
        brightness: 5,
        sharpen: true,
      },
      1080,
      1920,
    );
    expect(text).toBe(
      "Story, reel, TikTok or WhatsApp status, 1080 × 1920; whole photo on white; plain background removed (now white); light corrected; brightness +5%; sharpened",
    );
  });
});
