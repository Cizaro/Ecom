import type { AppTransaction } from "@ecom/db";
import {
  assertPermission,
  hasPermission,
  NotFoundError,
  type RequestContext,
} from "../access/context";
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
} from "../media/assets";
import { ImageError, sniffImageType } from "../media/image";
import { storeVideo, VideoError } from "../media/video";
import { authorNameFrom } from "../reviews/reviews";

// Photos and short videos from customers and creators ("UGC"). Rules:
//
// - Nothing is shown without recorded permission. A customer agrees to an
//   exact, versioned wording when sharing; staff adding a creator's content
//   must say where it was posted and how permission was given.
// - Permission can be withdrawn at any time from the customer's account: the
//   item is taken down at once and its file deleted. The record is kept
//   (without the file) as proof of what was agreed and when.
// - Customers share content of products they have received. Staff approve
//   everything before it is shown (staff with moderation rights who add
//   content themselves publish it directly).
// - Everything stays inside the store's own tenant.

export const UGC_PERMISSION_VERSION = "2026-11-18";
export const MAX_PENDING_PER_CUSTOMER = 10;
export const UGC_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "hidden",
  "withdrawn",
  "removed",
] as const;
export type UgcStatus = (typeof UGC_STATUSES)[number];

/** The exact words a customer agrees to when sharing. */
export function ugcPermissionText(storeName: string): string {
  return (
    `I took this photo or video and I allow ${storeName} to show it on its website ` +
    `and social media pages with the name I chose. I can withdraw this at any time ` +
    `from my account, and it will be taken down.`
  );
}

export class UgcError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "UgcError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value: unknown) =>
  typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";

export interface UgcMedia extends StoredImage {
  kind: "image" | "video";
  mimeType: string;
}

const MEDIA_SELECT = { ...ASSET_SELECT, kind: true, mimeType: true } as const;

function toMedia(asset: {
  id: string;
  storageKey: string;
  width: number;
  height: number;
  status: "processing" | "ready" | "failed";
  variants: unknown;
  kind: "image" | "video";
  mimeType: string;
}): UgcMedia {
  return { ...toStoredImage(asset as never), kind: asset.kind, mimeType: asset.mimeType };
}

/** Stores the file (photo or video) and its asset row; returns the asset. */
async function storeMedia(
  db: TenantDb,
  deps: MediaDeps,
  bytes: Uint8Array,
  userId: string | null,
): Promise<{ assetId: string; kind: "image" | "video"; keys: string[] }> {
  if (sniffImageType(bytes)) {
    let upload;
    try {
      upload = await storeUpload(db.tenantId, deps.storage, bytes);
    } catch (error) {
      if (error instanceof ImageError) {
        throw new UgcError(
          error.problem === "too_large"
            ? "The photo is too large (8 MB at most)."
            : "This photo could not be used. Try a JPEG or PNG at least 50 pixels on each side.",
          "file",
        );
      }
      throw error;
    }
    try {
      const asset = await db.run((tx) => insertAsset(tx, db.tenantId, userId, upload));
      return { assetId: asset.id, kind: "image", keys: [upload.storageKey] };
    } catch (error) {
      await deleteStoredFiles(deps, [upload.storageKey]);
      throw error;
    }
  }
  let video;
  try {
    video = await storeVideo(db.tenantId, deps.storage, bytes);
  } catch (error) {
    if (error instanceof VideoError) {
      throw new UgcError(
        error.problem === "too_large"
          ? "The video is too large (8 MB at most). Share a shorter clip."
          : error.problem === "empty"
            ? "Choose a photo or video to share."
            : "Share a photo (JPEG, PNG or WebP) or a video (MP4 or MOV).",
        "file",
      );
    }
    throw error;
  }
  try {
    const asset = await db.run((tx) =>
      tx.mediaAsset.create({
        data: {
          tenantId: db.tenantId,
          kind: "video",
          // Videos are used as uploaded: nothing for the worker to make.
          status: "ready",
          storageKey: video.storageKey,
          mimeType: video.mimeType,
          bytes: video.bytes,
          width: video.width,
          height: video.height,
          checksum: video.checksum,
          uploadedBy: userId,
        },
        select: { id: true },
      }),
    );
    return { assetId: asset.id, kind: "video", keys: [video.storageKey] };
  } catch (error) {
    await deleteStoredFiles(deps, [video.storageKey]);
    throw error;
  }
}

/** Products this customer has received, so they can share a photo of one. */
export async function productsCustomerReceived(
  db: TenantDb,
  customerId: string,
): Promise<{ id: string; name: string }[]> {
  return db.run((tx) =>
    tx.product.findMany({
      where: {
        variants: {
          some: {
            orderItems: {
              some: { order: { customerId, status: { in: ["fulfilled", "refunded"] } } },
            },
          },
        },
      },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 200,
    }),
  );
}

async function customerReceivedIn(tx: AppTransaction, customerId: string, productId: string) {
  return (
    (await tx.order.count({
      where: {
        customerId,
        status: { in: ["fulfilled", "refunded"] },
        items: { some: { variant: { productId } } },
      },
    })) > 0
  );
}

/** A customer shares a photo or video of a product they received. It waits for approval. */
export async function shareUgc(
  db: TenantDb,
  deps: MediaDeps,
  customer: { id: string; name: string },
  input: {
    productId: unknown;
    bytes: Uint8Array;
    caption?: unknown;
    creditName?: unknown;
    permission: unknown;
    storeName: string;
  },
): Promise<{ id: string }> {
  if (input.permission !== true && input.permission !== "on") {
    throw new UgcError("Tick the box to give permission to show it.", "permission");
  }
  const productId = typeof input.productId === "string" ? input.productId : "";
  if (!UUID.test(productId)) throw new UgcError("Choose the product it shows.", "productId");
  const caption = text(input.caption) || null;
  if (caption && caption.length > 300) {
    throw new UgcError("Shorten the caption (300 characters at most).", "caption");
  }
  const creditName = text(input.creditName) || authorNameFrom(customer.name);
  if (creditName.length > 60) {
    throw new UgcError("Shorten the name shown (60 characters at most).", "creditName");
  }
  await db.run(async (tx) => {
    if (!(await customerReceivedIn(tx, customer.id, productId))) {
      throw new UgcError("You can share photos of products you have received.", "productId");
    }
    const pending = await tx.ugcItem.count({
      where: { customerId: customer.id, status: "pending" },
    });
    if (pending >= MAX_PENDING_PER_CUSTOMER) {
      throw new UgcError(
        "You have several items waiting to be checked. Please wait for those first.",
      );
    }
  });

  const media = await storeMedia(db, deps, input.bytes, null);
  try {
    const created = await db.run(async (tx) => {
      const item = await tx.ugcItem.create({
        data: {
          tenantId: db.tenantId,
          mediaAssetId: media.assetId,
          kind: media.kind,
          source: "customer",
          customerId: customer.id,
          productId,
          caption,
          creditName,
          permissionText: ugcPermissionText(input.storeName),
          permissionVersion: UGC_PERMISSION_VERSION,
          permissionGrantedAt: new Date(),
        },
        select: { id: true },
      });
      await tx.consentRecord.create({
        data: {
          tenantId: db.tenantId,
          subjectType: "customer",
          subjectId: customer.id,
          purpose: "ugc_reuse",
          granted: true,
          source: `ugc:${item.id}`,
          policyVersion: UGC_PERMISSION_VERSION,
        },
      });
      return item;
    });
    if (media.kind === "image") {
      await requestProcessing(deps, { tenantId: db.tenantId, assetId: media.assetId });
    }
    return created;
  } catch (error) {
    await db.run((tx) => tx.mediaAsset.deleteMany({ where: { id: media.assetId } }));
    await deleteStoredFiles(deps, media.keys);
    throw error;
  }
}

export interface MyUgcItem {
  id: string;
  status: UgcStatus;
  kind: "image" | "video";
  caption: string | null;
  creditName: string;
  productName: string | null;
  media: UgcMedia | null;
  createdAt: Date;
  permissionWithdrawnAt: Date | null;
}

/** What a customer has shared, newest first. */
export async function listMyUgc(db: TenantDb, customerId: string): Promise<MyUgcItem[]> {
  const rows = await db.run((tx) =>
    tx.ugcItem.findMany({
      where: { customerId },
      select: {
        id: true,
        status: true,
        kind: true,
        caption: true,
        creditName: true,
        createdAt: true,
        permissionWithdrawnAt: true,
        product: { select: { name: true } },
        asset: { select: MEDIA_SELECT },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );
  return rows.map((row) => ({
    id: row.id,
    status: row.status as UgcStatus,
    kind: row.kind,
    caption: row.caption,
    creditName: row.creditName,
    productName: row.product?.name ?? null,
    media: row.asset ? toMedia(row.asset) : null,
    createdAt: row.createdAt,
    permissionWithdrawnAt: row.permissionWithdrawnAt,
  }));
}

/** Deletes an item's file, keeping the record. Returns the storage keys to remove. */
async function takeDownIn(
  tx: AppTransaction,
  itemId: string,
  status: "withdrawn" | "removed",
): Promise<string[]> {
  const item = await tx.ugcItem.findUnique({
    where: { id: itemId },
    select: { asset: { select: ASSET_SELECT } },
  });
  if (!item) throw new NotFoundError("item");
  await tx.ugcItem.update({
    where: { id: itemId },
    data: {
      status,
      mediaAssetId: null,
      featured: false,
      ...(status === "withdrawn" ? { permissionWithdrawnAt: new Date() } : {}),
    },
  });
  if (!item.asset) return [];
  await tx.mediaAsset.delete({ where: { id: item.asset.id } });
  return storedKeys(toStoredImage(item.asset));
}

/** The customer withdraws permission: taken down at once, file deleted, record kept. */
export async function withdrawUgc(
  db: TenantDb,
  deps: MediaDeps,
  customerId: string,
  itemId: string,
): Promise<void> {
  if (!UUID.test(itemId)) throw new NotFoundError("item");
  const keys = await db.run(async (tx) => {
    const item = await tx.ugcItem.findFirst({
      where: { id: itemId, customerId },
      select: { status: true },
    });
    if (!item) throw new NotFoundError("item");
    if (item.status === "withdrawn" || item.status === "removed") return [];
    const removed = await takeDownIn(tx, itemId, "withdrawn");
    await tx.consentRecord.create({
      data: {
        tenantId: db.tenantId,
        subjectType: "customer",
        subjectId: customerId,
        purpose: "ugc_reuse",
        granted: false,
        source: `ugc:${itemId}`,
        policyVersion: UGC_PERMISSION_VERSION,
      },
    });
    return removed;
  });
  await deleteStoredFiles(deps, keys);
}

export interface PublicUgcItem {
  id: string;
  caption: string | null;
  creditName: string;
  media: UgcMedia;
  product: { name: string; slug: string } | null;
}

/** Approved items: for one product, or the whole gallery (featured first). */
export async function listApprovedUgc(
  db: TenantDb,
  input: { productId?: string; limit?: number } = {},
): Promise<PublicUgcItem[]> {
  if (input.productId !== undefined && !UUID.test(input.productId)) return [];
  const rows = await db.run((tx) =>
    tx.ugcItem.findMany({
      where: {
        status: "approved",
        mediaAssetId: { not: null },
        ...(input.productId ? { productId: input.productId } : {}),
        // Products no longer for sale are not linked from the gallery.
      },
      select: {
        id: true,
        caption: true,
        creditName: true,
        asset: { select: MEDIA_SELECT },
        product: { select: { name: true, slug: true, status: true } },
      },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: Math.min(Math.max(input.limit ?? 24, 1), 60),
    }),
  );
  return rows
    .filter((row) => row.asset)
    .map((row) => ({
      id: row.id,
      caption: row.caption,
      creditName: row.creditName,
      media: toMedia(row.asset!),
      product:
        row.product && row.product.status === "active"
          ? { name: row.product.name, slug: row.product.slug }
          : null,
    }));
}

export async function countApprovedUgc(db: TenantDb): Promise<number> {
  return db.run((tx) =>
    tx.ugcItem.count({ where: { status: "approved", mediaAssetId: { not: null } } }),
  );
}

// --- Staff ---------------------------------------------------------------------

export interface ModerationUgcItem extends MyUgcItem {
  source: "customer" | "staff";
  featured: boolean;
  productId: string | null;
  sourceUrl: string | null;
  permissionText: string;
  permissionGrantedAt: Date;
}

export async function listUgcForModeration(
  db: TenantDb,
  context: RequestContext,
  input: { status?: UgcStatus } = {},
): Promise<{ items: ModerationUgcItem[]; pending: number }> {
  assertPermission(context, "reviews.moderate");
  const status = input.status && UGC_STATUSES.includes(input.status) ? input.status : "pending";
  return db.run(async (tx) => {
    const [pending, rows] = await Promise.all([
      tx.ugcItem.count({ where: { status: "pending" } }),
      tx.ugcItem.findMany({
        where: { status },
        select: {
          id: true,
          status: true,
          kind: true,
          caption: true,
          creditName: true,
          createdAt: true,
          permissionWithdrawnAt: true,
          source: true,
          featured: true,
          productId: true,
          sourceUrl: true,
          permissionText: true,
          permissionGrantedAt: true,
          product: { select: { name: true } },
          asset: { select: MEDIA_SELECT },
        },
        orderBy: { createdAt: "desc" },
        take: 60,
      }),
    ]);
    return {
      pending,
      items: rows.map((row) => ({
        id: row.id,
        status: row.status as UgcStatus,
        kind: row.kind,
        caption: row.caption,
        creditName: row.creditName,
        productName: row.product?.name ?? null,
        media: row.asset ? toMedia(row.asset) : null,
        createdAt: row.createdAt,
        permissionWithdrawnAt: row.permissionWithdrawnAt,
        source: row.source as "customer" | "staff",
        featured: row.featured,
        productId: row.productId,
        sourceUrl: row.sourceUrl,
        permissionText: row.permissionText,
        permissionGrantedAt: row.permissionGrantedAt,
      })),
    };
  });
}

/** Approves, rejects or hides an item; or features it at the top of the gallery. */
export async function moderateUgc(
  db: TenantDb,
  context: RequestContext,
  itemId: string,
  action: unknown,
): Promise<void> {
  assertPermission(context, "reviews.moderate");
  if (!UUID.test(itemId)) throw new NotFoundError("item");
  const allowed = ["approved", "rejected", "hidden", "feature", "unfeature"] as const;
  const next = allowed.find((value) => value === action);
  if (!next) throw new UgcError("Choose what to do with it.");
  await db.run(async (tx) => {
    const before = await tx.ugcItem.findUnique({
      where: { id: itemId },
      select: { status: true, featured: true, mediaAssetId: true },
    });
    if (!before) throw new NotFoundError("item");
    if (before.status === "withdrawn" || before.status === "removed" || !before.mediaAssetId) {
      throw new UgcError("This item was taken down; it cannot be shown again.");
    }
    const data =
      next === "feature" || next === "unfeature"
        ? { featured: next === "feature" }
        : { status: next, featured: next === "approved" ? before.featured : false };
    if (next === "feature" && before.status !== "approved") {
      throw new UgcError("Approve it before featuring it.");
    }
    await tx.ugcItem.update({
      where: { id: itemId },
      data: { ...data, moderatedAt: new Date(), moderatedBy: context.userId },
    });
    await audit(
      tx,
      context,
      "ugc.moderated",
      { type: "ugc_item", id: itemId },
      { status: before.status, featured: before.featured },
      { action: next },
    );
  });
}

/** Staff take an item down for good: the file is deleted, the record kept. */
export async function removeUgc(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  itemId: string,
): Promise<void> {
  assertPermission(context, "reviews.moderate");
  if (!UUID.test(itemId)) throw new NotFoundError("item");
  const keys = await db.run(async (tx) => {
    const removed = await takeDownIn(tx, itemId, "removed");
    await audit(tx, context, "ugc.removed", { type: "ugc_item", id: itemId });
    return removed;
  });
  await deleteStoredFiles(deps, keys);
}

/**
 * Staff add a creator's photo or video they have permission to use. Where it
 * was posted and how permission was given must be recorded. Staff who can
 * moderate publish it directly; others send it for approval.
 */
export async function addStaffUgc(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  input: {
    bytes: Uint8Array;
    productId?: unknown;
    caption?: unknown;
    creditName: unknown;
    sourceUrl: unknown;
    permissionNote: unknown;
    confirmed: unknown;
  },
): Promise<{ id: string }> {
  assertPermission(context, "content.write");
  if (input.confirmed !== true && input.confirmed !== "on") {
    throw new UgcError("Confirm that you have the creator's permission.", "confirmed");
  }
  const creditName = text(input.creditName);
  if (!creditName) throw new UgcError("Enter the creator's name or handle.", "creditName");
  if (creditName.length > 60)
    throw new UgcError("Shorten the name (60 characters at most).", "creditName");
  const sourceUrl = text(input.sourceUrl);
  let parsed: URL | null = null;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    parsed = null;
  }
  if (!parsed || parsed.protocol !== "https:" || sourceUrl.length > 500) {
    throw new UgcError("Enter the link to where it was first posted (https://...).", "sourceUrl");
  }
  const permissionNote =
    typeof input.permissionNote === "string" ? input.permissionNote.trim() : "";
  if (permissionNote.length < 10) {
    throw new UgcError(
      "Say how the creator gave permission and when (for example: by Instagram message on 12 November).",
      "permissionNote",
    );
  }
  if (permissionNote.length > 2000) throw new UgcError("Shorten the note.", "permissionNote");
  const caption = text(input.caption) || null;
  if (caption && caption.length > 300) throw new UgcError("Shorten the caption.", "caption");
  const productId =
    typeof input.productId === "string" && UUID.test(input.productId) ? input.productId : null;
  if (productId) {
    const exists = await db.run((tx) => tx.product.count({ where: { id: productId } }));
    if (!exists) throw new UgcError("Choose a product from the list.", "productId");
  }

  const media = await storeMedia(db, deps, input.bytes, context.userId);
  try {
    const created = await db.run(async (tx) => {
      const publish = hasPermission(context, "reviews.moderate");
      const item = await tx.ugcItem.create({
        data: {
          tenantId: db.tenantId,
          mediaAssetId: media.assetId,
          kind: media.kind,
          source: "staff",
          productId,
          caption,
          creditName,
          permissionText: permissionNote,
          permissionVersion: "staff-note",
          permissionGrantedAt: new Date(),
          sourceUrl: parsed!.toString(),
          createdByUserId: context.userId,
          status: publish ? "approved" : "pending",
          ...(publish ? { moderatedAt: new Date(), moderatedBy: context.userId } : {}),
        },
        select: { id: true },
      });
      await audit(tx, context, "ugc.staff_added", { type: "ugc_item", id: item.id }, undefined, {
        kind: media.kind,
        sourceUrl: parsed!.toString(),
        published: publish,
      });
      return item;
    });
    if (media.kind === "image") {
      await requestProcessing(deps, { tenantId: db.tenantId, assetId: media.assetId });
    }
    return created;
  } catch (error) {
    await db.run((tx) => tx.mediaAsset.deleteMany({ where: { id: media.assetId } }));
    await deleteStoredFiles(deps, media.keys);
    throw error;
  }
}
