import sharp from "sharp";

// Image handling. An uploaded file is never stored as it arrived: it is
// decoded and written out again, which removes embedded metadata (camera
// location, device details) and anything that is not image data.

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Largest stored side, in pixels. Bigger uploads are scaled down. */
export const MASTER_MAX_SIDE = 2560;
export const MIN_IMAGE_SIDE = 50;
/** Refuses decompression bombs: a small file that decodes to a huge picture. */
const MAX_INPUT_PIXELS = 50_000_000;
/** Widths of the resized versions made by the worker. */
export const VARIANT_WIDTHS = [320, 640, 1280] as const;

export type ImageType = "jpeg" | "png" | "webp";

export type ImageProblem = "empty" | "too_large" | "unsupported" | "unreadable" | "too_small";

export class ImageError extends Error {
  constructor(readonly problem: ImageProblem) {
    super(`image: ${problem}`);
    this.name = "ImageError";
  }
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0) =>
  bytes.length >= offset + signature.length &&
  signature.every((value, index) => bytes[offset + index] === value);

/**
 * The file type according to the file's own first bytes. The name and the
 * type the browser claims are ignored: both are chosen by the sender.
 */
export function sniffImageType(bytes: Uint8Array): ImageType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return "webp";
  return null;
}

export interface EncodedImage {
  body: Uint8Array;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
  extension: "jpg" | "png" | "webp";
  width: number;
  height: number;
}

/**
 * Checks an upload and produces the file that is stored: turned upright,
 * scaled down if very large, re-encoded without metadata. Pictures with
 * transparency stay PNG; everything else becomes JPEG.
 */
export async function prepareMaster(bytes: Uint8Array): Promise<EncodedImage> {
  if (bytes.length === 0) throw new ImageError("empty");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new ImageError("too_large");
  if (!sniffImageType(bytes)) throw new ImageError("unsupported");

  try {
    const input = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" });
    const metadata = await input.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      Math.min(metadata.width, metadata.height) < MIN_IMAGE_SIDE
    ) {
      throw new ImageError("too_small");
    }
    const pipeline = input
      .rotate() // applies the camera's orientation flag, which is then dropped
      .resize({
        width: MASTER_MAX_SIDE,
        height: MASTER_MAX_SIDE,
        fit: "inside",
        withoutEnlargement: true,
      });
    const transparent = metadata.hasAlpha === true;
    const { data, info } = await (
      transparent
        ? pipeline.png({ compressionLevel: 9 })
        : pipeline.jpeg({ quality: 88, mozjpeg: true })
    ).toBuffer({ resolveWithObject: true });
    return {
      body: new Uint8Array(data),
      mimeType: transparent ? "image/png" : "image/jpeg",
      extension: transparent ? "png" : "jpg",
      width: info.width,
      height: info.height,
    };
  } catch (error) {
    if (error instanceof ImageError) throw error;
    // The file has an image signature but cannot be decoded.
    throw new ImageError("unreadable");
  }
}

/**
 * Smaller WebP versions of a stored image, for product lists and phones.
 * Never larger than the stored image; a very small image gets one version at
 * its own width.
 */
export async function makeVariants(master: Uint8Array): Promise<EncodedImage[]> {
  const metadata = await sharp(master).metadata();
  const masterWidth = metadata.width ?? 0;
  if (masterWidth === 0) throw new ImageError("unreadable");
  const fitting = VARIANT_WIDTHS.filter((width) => width <= masterWidth);
  const widths = fitting.length > 0 ? fitting : [masterWidth];
  return Promise.all(
    widths.map(async (width) => {
      const { data, info } = await sharp(master)
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer({ resolveWithObject: true });
      return {
        body: new Uint8Array(data),
        mimeType: "image/webp" as const,
        extension: "webp" as const,
        width: info.width,
        height: info.height,
      };
    }),
  );
}
