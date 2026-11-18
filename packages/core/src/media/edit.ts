import sharp from "sharp";

type RGBA = { r: number; g: number; b: number; alpha: number };

// Making a version of a photo for a platform (Milestone 6.2, decision D106):
// the platform's size, cropped to fill or the whole photo on a background,
// light correction within narrow limits (so a product's colours stay true),
// and removal of a plain background. Everything runs here with the image
// library; no outside service is called.

export const EDIT_SIZES = {
  instagram_square: { label: "Instagram post, square", short: "Square", width: 1080, height: 1080 },
  instagram_portrait: {
    label: "Instagram or Facebook post, portrait",
    short: "Portrait",
    width: 1080,
    height: 1350,
  },
  story: {
    label: "Story, reel, TikTok or WhatsApp status",
    short: "Story",
    width: 1080,
    height: 1920,
  },
  facebook_landscape: {
    label: "Facebook post, landscape",
    short: "Landscape",
    width: 1200,
    height: 630,
  },
  original: { label: "Same size as the photo", short: "Edited", width: 0, height: 0 },
} as const;
export type EditSize = keyof typeof EDIT_SIZES;

export const EDIT_FITS = ["fill", "whole"] as const;
export type EditFit = (typeof EDIT_FITS)[number];
export const EDIT_POSITIONS = ["smart", "centre", "top", "bottom"] as const;
export type EditPosition = (typeof EDIT_POSITIONS)[number];
export const EDIT_BACKGROUNDS = ["white", "light", "black", "blur", "transparent"] as const;
export type EditBackground = (typeof EDIT_BACKGROUNDS)[number];
/** Brightness and colour changes allowed, in percent: small, so colours stay true. */
export const EDIT_STEPS = [-10, -5, 0, 5, 10] as const;

export interface EditOptions {
  size: EditSize;
  fit: EditFit;
  position: EditPosition;
  background: EditBackground;
  removeBackground: boolean;
  autoLight: boolean;
  brightness: number;
  saturation: number;
  sharpen: boolean;
}

export class EditError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "EditError";
  }
}

const pick = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T | null => {
  if (value === undefined || value === null || value === "") return fallback;
  return allowed.includes(value as T) ? (value as T) : null;
};
const flag = (value: unknown) => value === true || value === "on" || value === "true";

/** Checks the options a form sent; unknown values are refused, not guessed. */
export function parseEditOptions(input: Record<string, unknown>): EditOptions {
  const size = pick(input.size, Object.keys(EDIT_SIZES) as EditSize[], "instagram_square");
  if (!size) throw new EditError("Choose a size.", "size");
  const fit = pick(input.fit, EDIT_FITS, "fill");
  if (!fit) throw new EditError("Choose how the photo fits.", "fit");
  const position = pick(input.position, EDIT_POSITIONS, "smart");
  if (!position) throw new EditError("Choose what to keep when cropping.", "position");
  const background = pick(input.background, EDIT_BACKGROUNDS, "white");
  if (!background) throw new EditError("Choose a background.", "background");
  const step = (value: unknown, field: string) => {
    const number = value === undefined || value === "" ? 0 : Number(value);
    if (!(EDIT_STEPS as readonly number[]).includes(number)) {
      throw new EditError("Choose a change between -10% and +10%.", field);
    }
    return number;
  };
  const options: EditOptions = {
    size,
    fit,
    position,
    background,
    removeBackground: flag(input.removeBackground),
    autoLight: flag(input.autoLight),
    brightness: step(input.brightness, "brightness"),
    saturation: step(input.saturation, "saturation"),
    sharpen: flag(input.sharpen),
  };
  if (options.removeBackground && options.background === "blur") {
    throw new EditError(
      "A blurred background needs the photo's own background: choose another colour.",
      "background",
    );
  }
  return options;
}

const BACKGROUND_LABEL: Record<EditBackground, string> = {
  white: "white",
  light: "light grey",
  black: "black",
  blur: "a blurred copy of the photo",
  transparent: "transparent",
};

/** What was done, in words, for the library ("Story 1080 x 1920; whole photo on white"). */
export function describeEdit(options: EditOptions, width: number, height: number): string {
  const parts: string[] = [`${EDIT_SIZES[options.size].label}, ${width} × ${height}`];
  if (options.size !== "original") {
    parts.push(
      options.fit === "whole"
        ? `whole photo on ${BACKGROUND_LABEL[options.background]}`
        : `cropped to fill (${options.position === "smart" ? "keeping the busiest part" : `keeping the ${options.position === "centre" ? "centre" : options.position}`})`,
    );
  }
  if (options.removeBackground) {
    parts.push(`plain background removed (now ${BACKGROUND_LABEL[options.background]})`);
  }
  if (options.autoLight) parts.push("light corrected");
  const signed = (n: number) => `${n > 0 ? "+" : ""}${n}%`;
  if (options.brightness) parts.push(`brightness ${signed(options.brightness)}`);
  if (options.saturation) parts.push(`colour ${signed(options.saturation)}`);
  if (options.sharpen) parts.push("sharpened");
  return parts.join("; ").slice(0, 500);
}

/** How close a pixel must be to the background colour to count as background. */
const TOLERANCE = 38;

/**
 * Makes a plain background transparent: the colour along the photo's edges,
 * filled inwards from the edges, so a white bag on a white floor in the
 * middle is kept. Pixels near the edge of the product fade out softly.
 * Returns the share of the picture removed. Refuses photos whose edges are
 * not mostly one colour, or where almost nothing (or almost everything)
 * would go: the result would be wrong, and it is better to say so.
 */
export function removePlainBackground(rgba: Uint8Array, width: number, height: number): number {
  const total = width * height;
  const border: number[] = [];
  for (let x = 0; x < width; x++) border.push(x, (height - 1) * width + x);
  for (let y = 1; y < height - 1; y++) border.push(y * width, y * width + width - 1);

  const median = (channel: number) => {
    const values = border.map((p) => rgba[p * 4 + channel]!).sort((a, b) => a - b);
    return values[values.length >> 1]!;
  };
  const bg = [median(0), median(1), median(2)] as const;
  const distance = (p: number) => {
    const i = p * 4;
    const dr = rgba[i]! - bg[0];
    const dg = rgba[i + 1]! - bg[1];
    const db = rgba[i + 2]! - bg[2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  const plainEdges = border.filter((p) => distance(p) <= TOLERANCE).length / border.length;
  if (plainEdges < 0.6) {
    throw new EditError(
      "The photo's background is not plain enough to remove. Use a photo taken on a plain background.",
      "removeBackground",
    );
  }

  const removed = new Uint8Array(total);
  const stack = new Int32Array(total);
  let top = 0;
  for (const p of border) {
    if (!removed[p] && distance(p) <= TOLERANCE) {
      removed[p] = 1;
      stack[top++] = p;
    }
  }
  while (top > 0) {
    const p = stack[--top]!;
    const x = p % width;
    const neighbours = [
      x > 0 ? p - 1 : -1,
      x < width - 1 ? p + 1 : -1,
      p - width >= 0 ? p - width : -1,
      p + width < total ? p + width : -1,
    ];
    for (const q of neighbours) {
      if (q >= 0 && !removed[q] && distance(q) <= TOLERANCE) {
        removed[q] = 1;
        stack[top++] = q;
      }
    }
  }

  let count = 0;
  for (let p = 0; p < total; p++) if (removed[p]) count++;
  const share = count / total;
  if (share < 0.03 || share > 0.97) {
    throw new EditError(
      share < 0.03
        ? "There is almost no background to remove in this photo."
        : "The product could not be told apart from the background. Use a photo where it stands out.",
      "removeBackground",
    );
  }

  for (let p = 0; p < total; p++) {
    if (removed[p]) {
      rgba[p * 4 + 3] = 0;
      continue;
    }
    // A soft edge: kept pixels touching the background fade with their likeness to it.
    const x = p % width;
    const touches =
      (x > 0 && removed[p - 1]) ||
      (x < width - 1 && removed[p + 1]) ||
      (p - width >= 0 && removed[p - width]) ||
      (p + width < total && removed[p + width]);
    if (touches) {
      const d = distance(p);
      const alpha = Math.min(1, Math.max(0.35, (d - TOLERANCE) / TOLERANCE));
      rgba[p * 4 + 3] = Math.round(rgba[p * 4 + 3]! * alpha);
    }
  }
  return share;
}

const COLOURS: Record<Exclude<EditBackground, "blur">, RGBA> = {
  white: { r: 255, g: 255, b: 255, alpha: 1 },
  light: { r: 242, g: 242, b: 242, alpha: 1 },
  black: { r: 0, g: 0, b: 0, alpha: 1 },
  transparent: { r: 0, g: 0, b: 0, alpha: 0 },
};

export interface EditedImage {
  body: Uint8Array;
  mimeType: "image/jpeg" | "image/png";
  width: number;
  height: number;
  /** The photo was smaller than the size and was enlarged: it may look soft. */
  enlarged: boolean;
  /** Share of the picture removed as background, when asked. */
  removedShare: number | null;
}

/** Makes the version. The input is a stored (already cleaned) image. */
export async function editImage(master: Uint8Array, options: EditOptions): Promise<EditedImage> {
  const { data, info } = await sharp(master)
    .rotate()
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const pixels = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  const { width: w, height: h } = info;
  const removedShare = options.removeBackground ? removePlainBackground(pixels, w, h) : null;

  // Light and colour, then sharpening, on the full-size picture.
  let adjusted = sharp(pixels, { raw: { width: w, height: h, channels: 4 } });
  if (options.autoLight) adjusted = adjusted.normalise({ lower: 1, upper: 99 });
  if (options.brightness || options.saturation) {
    adjusted = adjusted.modulate({
      brightness: 1 + options.brightness / 100,
      saturation: 1 + options.saturation / 100,
    });
  }
  if (options.sharpen) adjusted = adjusted.sharpen({ sigma: 1 });
  const photo = await adjusted.png().toBuffer();

  const size = EDIT_SIZES[options.size];
  const width = size.width || w;
  const height = size.height || h;
  const whole = options.size !== "original" && options.fit === "whole";
  const scale = whole ? Math.min(width / w, height / h) : Math.max(width / w, height / h);

  const placed = await sharp(photo)
    .resize(width, height, {
      fit: whole ? "inside" : "cover",
      position:
        options.position === "smart"
          ? sharp.strategy.attention
          : options.position === "centre"
            ? "centre"
            : options.position,
    })
    .png()
    .toBuffer();

  const canvas =
    options.background === "blur"
      ? await sharp(photo)
          .resize(width, height, { fit: "cover" })
          .blur(40)
          .modulate({ brightness: 0.92 })
          .png()
          .toBuffer()
      : await sharp({
          create: { width, height, channels: 4, background: COLOURS[options.background] },
        })
          .png()
          .toBuffer();

  const transparent = options.background === "transparent" && (options.removeBackground || whole);
  const composed = sharp(canvas).composite([{ input: placed, gravity: "centre" }]);
  const { data: body, info: out } = await (
    transparent
      ? composed.png({ compressionLevel: 9 })
      : composed.flatten({ background: "#ffffff" }).jpeg({ quality: 92, mozjpeg: true })
  ).toBuffer({ resolveWithObject: true });

  return {
    body: new Uint8Array(body),
    mimeType: transparent ? "image/png" : "image/jpeg",
    width: out.width,
    height: out.height,
    enlarged: scale > 1.01,
    removedShare,
  };
}
