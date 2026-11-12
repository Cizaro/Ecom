import { createHash, randomBytes } from "node:crypto";
import type { AppTransaction } from "@ecom/db";
import type { TenantDb } from "../access/tenant-db";
import type { StorageProvider } from "../storage/storage";
import { makeVariants, prepareMaster, type EncodedImage } from "./image";

// Media assets: the database rows that describe files in object storage.
// Other modules (the catalog today) decide where an asset is used; this file
// knows how one is stored, described and resized.

export interface MediaProcessingJob {
  tenantId: string;
  assetId: string;
}

export interface MediaDeps {
  storage: StorageProvider;
  /**
   * Asks the worker to make the resized versions. An upload succeeds even if
   * this fails: the worker also looks for assets that were never processed.
   */
  enqueueProcessing?: (job: MediaProcessingJob) => Promise<void>;
  /** Told about problems that do not fail the request (for the log). */
  onWarning?: (message: string, detail: Record<string, unknown>) => void;
}

export type MediaStatusValue = "processing" | "ready" | "failed";

export interface StoredVariant {
  key: string;
  width: number;
  height: number;
  bytes: number;
  mimeType: string;
}

/** An image as stored: keys, not addresses. Turn it into addresses with `imageView`. */
export interface StoredImage {
  assetId: string;
  storageKey: string;
  width: number;
  height: number;
  status: MediaStatusValue;
  variants: StoredVariant[];
}

/** Addresses a page can put in an <img>. */
export interface ImageView {
  url: string;
  /** The smallest version available. */
  thumbnailUrl: string;
  /** For the `srcset` attribute; empty until the resized versions exist. */
  srcSet: string;
  width: number;
  height: number;
}

export const ASSET_SELECT = {
  id: true,
  storageKey: true,
  width: true,
  height: true,
  status: true,
  variants: true,
} as const;

interface AssetRow {
  id: string;
  storageKey: string;
  width: number;
  height: number;
  status: MediaStatusValue;
  variants: unknown;
}

function parseVariants(value: unknown): StoredVariant[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (item): item is StoredVariant =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as StoredVariant).key === "string" &&
        typeof (item as StoredVariant).width === "number" &&
        typeof (item as StoredVariant).height === "number",
    )
    .sort((a, b) => a.width - b.width);
}

export function toStoredImage(row: AssetRow): StoredImage {
  return {
    assetId: row.id,
    storageKey: row.storageKey,
    width: row.width,
    height: row.height,
    status: row.status,
    variants: parseVariants(row.variants),
  };
}

export function imageView(
  storage: Pick<StorageProvider, "publicUrl">,
  image: StoredImage,
): ImageView {
  const url = storage.publicUrl(image.storageKey);
  const smallest = image.variants[0];
  return {
    url,
    thumbnailUrl: smallest ? storage.publicUrl(smallest.key) : url,
    srcSet: image.variants
      .map((variant) => `${storage.publicUrl(variant.key)} ${variant.width}w`)
      .join(", "),
    width: image.width,
    height: image.height,
  };
}

/** Every file that belongs to an asset. */
export function storedKeys(image: Pick<StoredImage, "storageKey" | "variants">): string[] {
  return [image.storageKey, ...image.variants.map((variant) => variant.key)];
}

const folderOf = (storageKey: string) => storageKey.slice(0, storageKey.lastIndexOf("/"));

export interface StoredUpload extends Omit<EncodedImage, "body" | "extension"> {
  storageKey: string;
  bytes: number;
  checksum: string;
}

/**
 * Cleans an uploaded image and writes it to storage under the tenant's
 * prefix. The folder name is random, so an address cannot be guessed from
 * another one. Throws ImageError when the file is not an acceptable image.
 */
export async function storeUpload(
  tenantId: string,
  storage: StorageProvider,
  bytes: Uint8Array,
): Promise<StoredUpload> {
  const master = await prepareMaster(bytes);
  const folder = `public/${tenantId}/${randomBytes(16).toString("hex")}`;
  const storageKey = `${folder}/original.${master.extension}`;
  await storage.put(storageKey, master.body, { contentType: master.mimeType });
  return {
    storageKey,
    mimeType: master.mimeType,
    width: master.width,
    height: master.height,
    bytes: master.body.length,
    checksum: createHash("sha256").update(master.body).digest("hex"),
  };
}

export async function insertAsset(
  tx: AppTransaction,
  tenantId: string,
  userId: string | null,
  upload: StoredUpload,
): Promise<{ id: string }> {
  return tx.mediaAsset.create({
    data: {
      tenantId,
      kind: "image",
      storageKey: upload.storageKey,
      mimeType: upload.mimeType,
      bytes: upload.bytes,
      width: upload.width,
      height: upload.height,
      checksum: upload.checksum,
      uploadedBy: userId,
    },
    select: { id: true },
  });
}

/** Deletes files after their row is gone. A failure leaves unused files, which is logged. */
export async function deleteStoredFiles(deps: MediaDeps, keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await deps.storage.delete(keys);
  } catch (error) {
    deps.onWarning?.("media: files could not be deleted from storage", {
      keys: [...keys],
      err: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function requestProcessing(deps: MediaDeps, job: MediaProcessingJob): Promise<void> {
  if (!deps.enqueueProcessing) return;
  try {
    await deps.enqueueProcessing(job);
  } catch (error) {
    deps.onWarning?.("media: processing could not be queued; the worker will pick it up later", {
      assetId: job.assetId,
      err: error instanceof Error ? error.message : String(error),
    });
  }
}

export type ProcessOutcome = "ready" | "already_ready" | "missing";

/**
 * Makes the resized versions of an asset. Run by the worker, inside the
 * asset's tenant. Safe to run twice.
 */
export async function processMediaAsset(
  db: TenantDb,
  storage: StorageProvider,
  assetId: string,
): Promise<ProcessOutcome> {
  const asset = await db.run((tx) =>
    tx.mediaAsset.findUnique({
      where: { id: assetId },
      select: { storageKey: true, status: true },
    }),
  );
  if (!asset) return "missing";
  if (asset.status === "ready") return "already_ready";

  const master = await storage.get(asset.storageKey);
  const encoded = await makeVariants(master);
  const folder = folderOf(asset.storageKey);
  const variants: StoredVariant[] = [];
  for (const variant of encoded) {
    const key = `${folder}/w${variant.width}.${variant.extension}`;
    await storage.put(key, variant.body, { contentType: variant.mimeType });
    variants.push({
      key,
      width: variant.width,
      height: variant.height,
      bytes: variant.body.length,
      mimeType: variant.mimeType,
    });
  }

  const updated = await db.run((tx) =>
    tx.mediaAsset.updateMany({
      where: { id: assetId },
      data: {
        status: "ready",
        processingError: null,
        variants: variants.map((variant) => ({ ...variant })),
      },
    }),
  );
  if (updated.count === 0) {
    // Removed while it was being processed: do not leave its files behind.
    await storage.delete(variants.map((variant) => variant.key));
    return "missing";
  }
  return "ready";
}

/** Records that resizing gave up. The uploaded image is still shown. */
export async function markMediaAssetFailed(
  db: TenantDb,
  assetId: string,
  reason: string,
): Promise<void> {
  await db.run((tx) =>
    tx.mediaAsset.updateMany({
      where: { id: assetId, status: "processing" },
      data: { status: "failed", processingError: reason.slice(0, 500) },
    }),
  );
}
