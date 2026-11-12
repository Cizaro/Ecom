import type { AppTransaction } from "@ecom/db";
import { z } from "zod";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import {
  ASSET_SELECT,
  deleteStoredFiles,
  insertAsset,
  requestProcessing,
  storedKeys,
  storeUpload,
  toStoredImage,
  type MediaDeps,
  type StoredImage,
  type StoredUpload,
} from "../media/assets";
import { ImageError, MAX_UPLOAD_BYTES, MIN_IMAGE_SIDE, type ImageProblem } from "../media/image";
import { assertId, CatalogError, optionalId, parseInput } from "./errors";

// Pictures in the catalog: a product's images (ordered, the first is the main
// one), a category's image and a brand's logo. Every function checks the
// permission and runs inside the tenant; files are stored under the tenant's
// own prefix.

export const MAX_PRODUCT_IMAGES = 20;
export const MAX_ALT_TEXT_LENGTH = 300;

export interface ProductImageDetail {
  id: string;
  altText: string;
  variantId: string | null;
  /** The first image is the one shown in lists and shared links. */
  isMain: boolean;
  image: StoredImage;
}

const megabytes = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024));

const IMAGE_MESSAGES: Record<ImageProblem, string> = {
  empty: "Choose an image file to upload.",
  too_large: `The image is too large. The limit is ${megabytes} MB.`,
  unsupported: "Use a JPEG, PNG or WebP image.",
  unreadable: "This file could not be read as an image. Try saving it again and re-uploading.",
  too_small: `The image is too small. Use one at least ${MIN_IMAGE_SIDE} pixels on each side.`,
};

async function storeImage(db: TenantDb, deps: MediaDeps, bytes: Uint8Array): Promise<StoredUpload> {
  try {
    return await storeUpload(db.tenantId, deps.storage, bytes);
  } catch (error) {
    if (error instanceof ImageError) {
      throw new CatalogError(
        error.problem === "too_large" ? "image_too_large" : "invalid_image",
        IMAGE_MESSAGES[error.problem],
        "image",
      );
    }
    throw error;
  }
}

/**
 * Runs the database part of an upload. If it fails, the file that was just
 * stored is removed again so nothing is left without a row.
 */
async function withUpload<T>(
  db: TenantDb,
  deps: MediaDeps,
  upload: StoredUpload,
  work: (tx: AppTransaction) => Promise<T>,
): Promise<T> {
  try {
    return await db.run(work);
  } catch (error) {
    await deleteStoredFiles(deps, [upload.storageKey]);
    throw error;
  }
}

const IMAGE_ORDER = [{ position: "asc" as const }, { createdAt: "asc" as const }];

// --- Product images ----------------------------------------------------------

export async function listProductImages(
  db: TenantDb,
  context: RequestContext,
  productId: string,
): Promise<ProductImageDetail[]> {
  assertPermission(context, "catalog.read");
  assertId(productId, "product");
  const product = await db.run((tx) =>
    tx.product.findUnique({
      where: { id: productId },
      select: {
        images: {
          select: { id: true, altText: true, variantId: true, asset: { select: ASSET_SELECT } },
          orderBy: IMAGE_ORDER,
        },
      },
    }),
  );
  if (!product) throw new NotFoundError("product");
  return product.images.map((row, index) => ({
    id: row.id,
    altText: row.altText,
    variantId: row.variantId,
    isMain: index === 0,
    image: toStoredImage(row.asset),
  }));
}

const altTextField = z
  .string()
  .trim()
  .max(
    MAX_ALT_TEXT_LENGTH,
    `The description is too long (${MAX_ALT_TEXT_LENGTH} characters at most).`,
  )
  .nullish()
  .transform((value) => value ?? "");

async function assertRoomForImage(tx: AppTransaction, productId: string): Promise<number> {
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: { images: { select: { position: true } } },
  });
  if (!product) throw new NotFoundError("product");
  if (product.images.length >= MAX_PRODUCT_IMAGES) {
    throw new CatalogError(
      "too_many_images",
      `A product can have ${MAX_PRODUCT_IMAGES} images at most. Remove one first.`,
      "image",
    );
  }
  return product.images.reduce((highest, image) => Math.max(highest, image.position), -1) + 1;
}

/** Adds an image at the end of the product's images. */
export async function addProductImage(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  productId: string,
  input: { bytes: Uint8Array; altText?: string | null },
): Promise<{ id: string; assetId: string }> {
  assertPermission(context, "catalog.write");
  assertId(productId, "product");
  const altText = parseInput(altTextField, input.altText);
  // Checked before the file is processed, and again with the insert.
  await db.run((tx) => assertRoomForImage(tx, productId));

  const upload = await storeImage(db, deps, input.bytes);
  const created = await withUpload(db, deps, upload, async (tx) => {
    const position = await assertRoomForImage(tx, productId);
    const asset = await insertAsset(tx, db.tenantId, context.userId, upload);
    const image = await tx.productImage.create({
      data: { tenantId: db.tenantId, productId, mediaAssetId: asset.id, altText, position },
      select: { id: true },
    });
    await audit(
      tx,
      context,
      "catalog.product_image_added",
      { type: "product", id: productId },
      undefined,
      { imageId: image.id, bytes: upload.bytes, width: upload.width, height: upload.height },
    );
    return { id: image.id, assetId: asset.id };
  });
  await requestProcessing(deps, { tenantId: db.tenantId, assetId: created.assetId });
  return created;
}

const imageUpdateInput = z.object({ altText: altTextField, variantId: optionalId("variant") });

export type ProductImageUpdateInput = z.input<typeof imageUpdateInput>;

/** Changes an image's description and the variant it shows, if any. */
export async function updateProductImage(
  db: TenantDb,
  context: RequestContext,
  imageId: string,
  input: ProductImageUpdateInput,
): Promise<{ productId: string }> {
  assertPermission(context, "catalog.write");
  assertId(imageId, "image");
  const data = parseInput(imageUpdateInput, input);
  return db.run(async (tx) => {
    const before = await tx.productImage.findUnique({
      where: { id: imageId },
      select: { productId: true, altText: true, variantId: true },
    });
    if (!before) throw new NotFoundError("image");
    if (data.variantId !== null) {
      const variant = await tx.productVariant.findFirst({
        where: { id: data.variantId, productId: before.productId },
        select: { id: true },
      });
      if (!variant) {
        throw new CatalogError("unknown_reference", "Choose a variant from the list.", "variantId");
      }
    }
    await tx.productImage.update({ where: { id: imageId }, data });
    await audit(
      tx,
      context,
      "catalog.product_image_updated",
      { type: "product", id: before.productId },
      { imageId, altText: before.altText, variantId: before.variantId },
      { imageId, altText: data.altText, variantId: data.variantId },
    );
    return { productId: before.productId };
  });
}

export const IMAGE_MOVES = ["earlier", "later", "first"] as const;
export type ImageMove = (typeof IMAGE_MOVES)[number];

/** Moves an image one place, or to the front (which makes it the main image). */
export async function moveProductImage(
  db: TenantDb,
  context: RequestContext,
  imageId: string,
  move: ImageMove,
): Promise<{ productId: string }> {
  assertPermission(context, "catalog.write");
  assertId(imageId, "image");
  return db.run(async (tx) => {
    const image = await tx.productImage.findUnique({
      where: { id: imageId },
      select: { productId: true },
    });
    if (!image) throw new NotFoundError("image");
    const siblings = await tx.productImage.findMany({
      where: { productId: image.productId },
      select: { id: true, position: true },
      orderBy: IMAGE_ORDER,
    });
    const from = siblings.findIndex((sibling) => sibling.id === imageId);
    const to =
      move === "first"
        ? 0
        : Math.min(siblings.length - 1, Math.max(0, from + (move === "earlier" ? -1 : 1)));
    if (from !== to) {
      const [moved] = siblings.splice(from, 1);
      siblings.splice(to, 0, moved!);
    }
    // Rewrites every position, which also closes gaps left by removed images.
    for (const [position, sibling] of siblings.entries()) {
      if (sibling.position !== position) {
        await tx.productImage.update({ where: { id: sibling.id }, data: { position } });
      }
    }
    if (from !== to) {
      await audit(
        tx,
        context,
        "catalog.product_image_moved",
        { type: "product", id: image.productId },
        { imageId, position: from },
        { imageId, position: to },
      );
    }
    return { productId: image.productId };
  });
}

/** Removes an image and its files. */
export async function removeProductImage(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  imageId: string,
): Promise<{ productId: string }> {
  assertPermission(context, "catalog.write");
  assertId(imageId, "image");
  const removed = await db.run(async (tx) => {
    const image = await tx.productImage.findUnique({
      where: { id: imageId },
      select: { productId: true, altText: true, asset: { select: ASSET_SELECT } },
    });
    if (!image) throw new NotFoundError("image");
    // Deleting the asset removes the image row with it.
    await tx.mediaAsset.delete({ where: { id: image.asset.id } });
    await audit(
      tx,
      context,
      "catalog.product_image_removed",
      { type: "product", id: image.productId },
      { imageId, altText: image.altText },
    );
    return { productId: image.productId, keys: storedKeys(toStoredImage(image.asset)) };
  });
  await deleteStoredFiles(deps, removed.keys);
  return { productId: removed.productId };
}

// --- Category image and brand logo -------------------------------------------

type Owner = "category" | "brand";

const OWNER_ACTION: Record<Owner, { set: string; removed: string }> = {
  category: { set: "catalog.category_image_set", removed: "catalog.category_image_removed" },
  brand: { set: "catalog.brand_logo_set", removed: "catalog.brand_logo_removed" },
};

/** The owner's current asset, or NotFound when the owner does not exist. */
async function currentAsset(tx: AppTransaction, owner: Owner, id: string) {
  const row =
    owner === "category"
      ? await tx.category.findUnique({
          where: { id },
          select: { image: { select: ASSET_SELECT } },
        })
      : await tx.brand
          .findUnique({ where: { id }, select: { logo: { select: ASSET_SELECT } } })
          .then((brand) => (brand ? { image: brand.logo } : null));
  if (!row) throw new NotFoundError(owner);
  return row.image ? toStoredImage(row.image) : null;
}

async function linkAsset(tx: AppTransaction, owner: Owner, id: string, assetId: string | null) {
  if (owner === "category") {
    await tx.category.update({ where: { id }, data: { imageAssetId: assetId } });
  } else {
    await tx.brand.update({ where: { id }, data: { logoAssetId: assetId } });
  }
}

async function getOwnerImage(
  db: TenantDb,
  context: RequestContext,
  owner: Owner,
  id: string,
): Promise<StoredImage | null> {
  assertPermission(context, "catalog.read");
  assertId(id, owner);
  return db.run((tx) => currentAsset(tx, owner, id));
}

async function setOwnerImage(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  owner: Owner,
  id: string,
  bytes: Uint8Array,
): Promise<{ assetId: string }> {
  assertPermission(context, "catalog.write");
  assertId(id, owner);
  await db.run((tx) => currentAsset(tx, owner, id));

  const upload = await storeImage(db, deps, bytes);
  const result = await withUpload(db, deps, upload, async (tx) => {
    const previous = await currentAsset(tx, owner, id);
    const asset = await insertAsset(tx, db.tenantId, context.userId, upload);
    await linkAsset(tx, owner, id, asset.id);
    if (previous) await tx.mediaAsset.delete({ where: { id: previous.assetId } });
    await audit(tx, context, OWNER_ACTION[owner].set, { type: owner, id }, undefined, {
      bytes: upload.bytes,
      width: upload.width,
      height: upload.height,
      replaced: previous !== null,
    });
    return { assetId: asset.id, oldKeys: previous ? storedKeys(previous) : [] };
  });
  await deleteStoredFiles(deps, result.oldKeys);
  await requestProcessing(deps, { tenantId: db.tenantId, assetId: result.assetId });
  return { assetId: result.assetId };
}

async function removeOwnerImage(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  owner: Owner,
  id: string,
): Promise<void> {
  assertPermission(context, "catalog.write");
  assertId(id, owner);
  const keys = await db.run(async (tx) => {
    const previous = await currentAsset(tx, owner, id);
    if (!previous) return [];
    // The link is cleared by the database when the asset goes.
    await tx.mediaAsset.delete({ where: { id: previous.assetId } });
    await audit(tx, context, OWNER_ACTION[owner].removed, { type: owner, id });
    return storedKeys(previous);
  });
  await deleteStoredFiles(deps, keys);
}

export const getCategoryImage = (db: TenantDb, context: RequestContext, id: string) =>
  getOwnerImage(db, context, "category", id);
export const setCategoryImage = (
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  id: string,
  bytes: Uint8Array,
) => setOwnerImage(db, context, deps, "category", id, bytes);
export const removeCategoryImage = (
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  id: string,
) => removeOwnerImage(db, context, deps, "category", id);

export const getBrandLogo = (db: TenantDb, context: RequestContext, id: string) =>
  getOwnerImage(db, context, "brand", id);
export const setBrandLogo = (
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  id: string,
  bytes: Uint8Array,
) => setOwnerImage(db, context, deps, "brand", id, bytes);
export const removeBrandLogo = (
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  id: string,
) => removeOwnerImage(db, context, deps, "brand", id);
