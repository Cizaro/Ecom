/**
 * A tiny file shaped like an MP4 (or QuickTime) video: a "ftyp" box and a
 * track header ("tkhd") with the given picture size. Enough for the checks
 * the app makes; it does not play.
 */
export function makeTestVideo(
  options: { width?: number; height?: number; brand?: "isom" | "qt  "; padTo?: number } = {},
): Uint8Array {
  const { width = 1080, height = 1920, brand = "isom", padTo = 0 } = options;
  const ftyp = new Uint8Array(16);
  const ftypView = new DataView(ftyp.buffer);
  ftypView.setUint32(0, 16);
  ftyp.set(
    [..."ftyp"].map((c) => c.charCodeAt(0)),
    4,
  );
  ftyp.set(
    [...brand].map((c) => c.charCodeAt(0)),
    8,
  );

  // Version 0 track header: 92 bytes, width and height at offsets 84 and 88 (16.16 fixed point).
  const tkhd = new Uint8Array(92);
  const tkhdView = new DataView(tkhd.buffer);
  tkhdView.setUint32(0, 92);
  tkhd.set(
    [..."tkhd"].map((c) => c.charCodeAt(0)),
    4,
  );
  tkhdView.setUint32(84, width << 16);
  tkhdView.setUint32(88, height << 16);

  const size = Math.max(ftyp.length + tkhd.length, padTo);
  const file = new Uint8Array(size);
  file.set(ftyp, 0);
  file.set(tkhd, ftyp.length);
  return file;
}
