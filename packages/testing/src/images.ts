import sharp from "sharp";

export interface TestImageOptions {
  width?: number;
  height?: number;
  format?: "jpeg" | "png" | "webp";
  /** Adds a transparent background (PNG and WebP). */
  transparent?: boolean;
  /** Embeds camera metadata, including a location, as a phone photo would. */
  withLocation?: boolean;
}

/** A generated picture for upload tests. Nothing is read from disk. */
export async function makeTestImage(options: TestImageOptions = {}): Promise<Buffer> {
  const { width = 800, height = 600, format = "jpeg" } = options;
  let image = sharp({
    create: {
      width,
      height,
      channels: options.transparent ? 4 : 3,
      background: options.transparent
        ? { r: 200, g: 60, b: 60, alpha: 0.5 }
        : { r: 200, g: 60, b: 60 },
    },
  });
  if (options.withLocation) {
    image = image.withExif({
      IFD0: { Make: "TestCam", Model: "Phone 1", Software: "test" },
      IFD3: {
        GPSLatitudeRef: "N",
        GPSLatitude: "51/1 30/1 0/1",
        GPSLongitudeRef: "W",
        GPSLongitude: "0/1 7/1 0/1",
      },
    });
  }
  return image[format]().toBuffer();
}
