import { createHash, randomBytes } from "node:crypto";
import type { StorageProvider } from "../storage/storage";

// Short videos (customer reels). Stored as uploaded: no re-encoding, so only
// MP4 and QuickTime (what phones record) are accepted, checked by their bytes,
// with a size limit that keeps clips short. The picture size is read from the
// file so the page can reserve the right shape before it loads.

export const MAX_VIDEO_BYTES = 8 * 1024 * 1024;

export type VideoProblem = "empty" | "too_large" | "unsupported";

export class VideoError extends Error {
  constructor(readonly problem: VideoProblem) {
    super(`video: ${problem}`);
    this.name = "VideoError";
  }
}

/** "video/mp4" or "video/quicktime" from the file's own bytes; null for anything else. */
export function sniffVideoType(bytes: Uint8Array): "video/mp4" | "video/quicktime" | null {
  if (bytes.length < 12) return null;
  const box = String.fromCharCode(...bytes.subarray(4, 8));
  if (box !== "ftyp") return null;
  const brand = String.fromCharCode(...bytes.subarray(8, 12));
  return brand === "qt  " ? "video/quicktime" : "video/mp4";
}

/**
 * The picture size from the first video track header ("tkhd" box) with a
 * size; null when it cannot be found.
 */
export function videoDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // i is where "tkhd" starts; the box starts 4 bytes earlier and the size ends 88 bytes after i.
  for (let i = 4; i + 88 <= bytes.length; i += 1) {
    // "tkhd"
    if (
      bytes[i] !== 0x74 ||
      bytes[i + 1] !== 0x6b ||
      bytes[i + 2] !== 0x68 ||
      bytes[i + 3] !== 0x64
    ) {
      continue;
    }
    const start = i - 4;
    const version = bytes[i + 4];
    const offset = start + 8 + 4 + (version === 1 ? 32 : 20) + 8 + 8 + 36;
    if (offset + 8 > bytes.length) return null;
    const width = view.getUint32(offset) >>> 16;
    const height = view.getUint32(offset + 4) >>> 16;
    if (width > 0 && height > 0 && width <= 8192 && height <= 8192) return { width, height };
  }
  return null;
}

export interface StoredVideo {
  storageKey: string;
  mimeType: string;
  width: number;
  height: number;
  bytes: number;
  checksum: string;
}

/** Checks and stores a video under the tenant's prefix. Throws VideoError when unusable. */
export async function storeVideo(
  tenantId: string,
  storage: StorageProvider,
  bytes: Uint8Array,
): Promise<StoredVideo> {
  if (bytes.length === 0) throw new VideoError("empty");
  if (bytes.length > MAX_VIDEO_BYTES) throw new VideoError("too_large");
  const mimeType = sniffVideoType(bytes);
  if (!mimeType) throw new VideoError("unsupported");
  // Phones record upright clips; when the size cannot be read, assume that shape.
  const size = videoDimensions(bytes) ?? { width: 1080, height: 1920 };
  const extension = mimeType === "video/quicktime" ? "mov" : "mp4";
  const storageKey = `public/${tenantId}/${randomBytes(16).toString("hex")}/original.${extension}`;
  await storage.put(storageKey, Buffer.from(bytes), { contentType: mimeType });
  return {
    storageKey,
    mimeType,
    ...size,
    bytes: bytes.length,
    checksum: createHash("sha256").update(bytes).digest("hex"),
  };
}
