import { makeTestImage } from "@ecom/testing";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  ImageError,
  makeVariants,
  MASTER_MAX_SIDE,
  MAX_UPLOAD_BYTES,
  prepareMaster,
  sniffImageType,
  type ImageProblem,
} from "./image";

async function problemOf(work: Promise<unknown>): Promise<ImageProblem | "none"> {
  try {
    await work;
    return "none";
  } catch (error) {
    if (error instanceof ImageError) return error.problem;
    throw error;
  }
}

describe("sniffImageType", () => {
  it("recognises the three accepted types from their first bytes", async () => {
    expect(sniffImageType(await makeTestImage({ format: "jpeg" }))).toBe("jpeg");
    expect(sniffImageType(await makeTestImage({ format: "png" }))).toBe("png");
    expect(sniffImageType(await makeTestImage({ format: "webp" }))).toBe("webp");
  });

  it("rejects everything else, whatever it is called", () => {
    expect(sniffImageType(Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBeNull();
    expect(sniffImageType(Buffer.from("GIF89a..."))).toBeNull();
    expect(sniffImageType(Buffer.from("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImageType(Buffer.from("MZ\x90\x00"))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe("prepareMaster", () => {
  it("removes camera metadata, including the location", async () => {
    const upload = await makeTestImage({ withLocation: true });
    const before = await sharp(upload).metadata();
    expect(before.exif, "the test image must carry metadata").toBeDefined();
    expect(upload.includes("TestCam")).toBe(true);

    const master = await prepareMaster(upload);
    const after = await sharp(master.body).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(Buffer.from(master.body).includes("TestCam")).toBe(false);
  });

  it("stores photographs as JPEG and keeps transparency as PNG", async () => {
    const photo = await prepareMaster(await makeTestImage({ format: "webp" }));
    expect(photo).toMatchObject({ mimeType: "image/jpeg", extension: "jpg", width: 800 });
    expect(sniffImageType(photo.body)).toBe("jpeg");

    const logo = await prepareMaster(await makeTestImage({ format: "png", transparent: true }));
    expect(logo).toMatchObject({ mimeType: "image/png", extension: "png" });
    expect(sniffImageType(logo.body)).toBe("png");
  });

  it("scales very large pictures down and never enlarges small ones", async () => {
    const large = await prepareMaster(await makeTestImage({ width: 4000, height: 1000 }));
    expect(large.width).toBe(MASTER_MAX_SIDE);
    expect(large.height).toBe(640);
    const small = await prepareMaster(await makeTestImage({ width: 120, height: 90 }));
    expect([small.width, small.height]).toEqual([120, 90]);
  });

  it("turns a sideways phone photo upright", async () => {
    const sideways = await sharp(await makeTestImage({ width: 400, height: 200 }))
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    const master = await prepareMaster(sideways);
    expect([master.width, master.height]).toEqual([200, 400]);
  });

  it("refuses files that are not acceptable images", async () => {
    expect(await problemOf(prepareMaster(new Uint8Array()))).toBe("empty");
    expect(await problemOf(prepareMaster(Buffer.from("just some text")))).toBe("unsupported");
    expect(await problemOf(prepareMaster(Buffer.from("GIF89a" + "x".repeat(50))))).toBe(
      "unsupported",
    );
    // Starts like a PNG but is not one.
    const fake = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.from("<script>alert(1)</script>".repeat(20)),
    ]);
    expect(await problemOf(prepareMaster(fake))).toBe("unreadable");
    expect(await problemOf(prepareMaster(await makeTestImage({ width: 40, height: 40 })))).toBe(
      "too_small",
    );
    const oversized = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    expect(await problemOf(prepareMaster(oversized))).toBe("too_large");
  });
});

describe("makeVariants", () => {
  it("makes WebP versions no wider than the stored image", async () => {
    const master = await prepareMaster(await makeTestImage({ width: 1000, height: 500 }));
    const variants = await makeVariants(master.body);
    expect(variants.map((variant) => variant.width)).toEqual([320, 640]);
    expect(variants.map((variant) => variant.height)).toEqual([160, 320]);
    for (const variant of variants) expect(sniffImageType(variant.body)).toBe("webp");
  });

  it("gives a very small image one version at its own width", async () => {
    const master = await prepareMaster(await makeTestImage({ width: 100, height: 100 }));
    const variants = await makeVariants(master.body);
    expect(variants.map((variant) => variant.width)).toEqual([100]);
  });
});
