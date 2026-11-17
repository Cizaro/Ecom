import { makeTestVideo } from "@ecom/testing";
import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "../storage/storage";
import { MAX_VIDEO_BYTES, sniffVideoType, storeVideo, videoDimensions, VideoError } from "./video";

describe("videos", () => {
  it("are recognised by their bytes, not their name", () => {
    expect(sniffVideoType(makeTestVideo())).toBe("video/mp4");
    expect(sniffVideoType(makeTestVideo({ brand: "qt  " }))).toBe("video/quicktime");
    expect(sniffVideoType(new TextEncoder().encode("<script>alert(1)</script>"))).toBeNull();
  });

  it("have their picture size read from the file", () => {
    expect(videoDimensions(makeTestVideo({ width: 720, height: 1280 }))).toEqual({
      width: 720,
      height: 1280,
    });
    expect(videoDimensions(new Uint8Array(200))).toBeNull();
  });

  it("are stored under the store's own prefix, and refused when not a video or too large", async () => {
    const storage = createMemoryStorage();
    const tenant = "00000000-0000-4000-8000-000000000001";
    const stored = await storeVideo(tenant, storage, makeTestVideo({ width: 640, height: 360 }));
    expect(stored).toMatchObject({ mimeType: "video/mp4", width: 640, height: 360 });
    expect(stored.storageKey).toMatch(new RegExp(`^public/${tenant}/[0-9a-f]{32}/original[.]mp4$`));
    expect(storage.files.get(stored.storageKey)?.contentType).toBe("video/mp4");

    await expect(storeVideo(tenant, storage, new Uint8Array(0))).rejects.toThrow(VideoError);
    await expect(
      storeVideo(tenant, storage, makeTestVideo({ padTo: MAX_VIDEO_BYTES + 1 })),
    ).rejects.toThrow(VideoError);
    await expect(
      storeVideo(tenant, storage, new TextEncoder().encode("GIF89a not a video")),
    ).rejects.toThrow(VideoError);
  });
});
