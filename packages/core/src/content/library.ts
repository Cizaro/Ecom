import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import {
  ASSET_SELECT,
  deleteStoredFiles,
  insertAsset,
  requestProcessing,
  storeUpload,
  toStoredImage,
  type MediaDeps,
  type StoredImage,
} from "../media/assets";
import { describeEdit, EDIT_SIZES, editImage, EditError, parseEditOptions } from "../media/edit";
import { ImageError, sniffImageType } from "../media/image";
import { storeVideo, VideoError } from "../media/video";

// The content library (Milestone 6.1, decision D105): photos and videos the
// store uses for marketing, each with a title, tags, alt text and a note of
// who owns it and the permission to use it. Uploading and editing need
// content.write. Files are cleaned like every upload: images are re-encoded
// (no hidden data) and resized by the worker; videos are checked by their bytes.

export class ContentError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ContentError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const assertUuid = (id: string, what: string) => {
  if (!UUID.test(id)) throw new NotFoundError(what);
};

export interface LibraryItem {
  id: string;
  title: string;
  altText: string;
  tags: string[];
  usageNote: string;
  kind: "image" | "video";
  mimeType: string;
  media: StoredImage;
  archived: boolean;
  createdAt: Date;
  /** How many posts use it. */
  postCount: number;
  /** The file this one was made from, if it is a version (D106). */
  derivedFrom: { id: string; title: string } | null;
  /** What was done to make it. */
  editNote: string;
  /** How many versions were made from it. */
  versionCount: number;
}

const SELECT = {
  id: true,
  title: true,
  altText: true,
  tags: true,
  usageNote: true,
  archivedAt: true,
  createdAt: true,
  media: { select: { ...ASSET_SELECT, kind: true, mimeType: true } },
  editNote: true,
  derivedFrom: { select: { id: true, title: true } },
  _count: { select: { posts: true, versions: true } },
} as const;

type Row = {
  id: string;
  title: string;
  altText: string;
  tags: string[];
  usageNote: string;
  archivedAt: Date | null;
  createdAt: Date;
  media: Parameters<typeof toStoredImage>[0] & { kind: "image" | "video"; mimeType: string };
  editNote: string;
  derivedFrom: { id: string; title: string } | null;
  _count: { posts: number; versions: number };
};

const toItem = (row: Row): LibraryItem => ({
  id: row.id,
  title: row.title,
  altText: row.altText,
  tags: row.tags,
  usageNote: row.usageNote,
  kind: row.media.kind,
  mimeType: row.media.mimeType,
  media: toStoredImage(row.media),
  archived: row.archivedAt !== null,
  createdAt: row.createdAt,
  postCount: row._count.posts,
  derivedFrom: row.derivedFrom,
  editNote: row.editNote,
  versionCount: row._count.versions,
});

function cleanText(input: {
  title?: unknown;
  altText?: unknown;
  tags?: unknown;
  usageNote?: unknown;
}) {
  const text = (value: unknown) =>
    typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  const title = text(input.title);
  if (!title) throw new ContentError("Give the file a title.", "title");
  if (title.length > 120)
    throw new ContentError("Shorten the title (120 characters at most).", "title");
  const altText = text(input.altText);
  if (altText.length > 300) {
    throw new ContentError("Shorten the description (300 characters at most).", "altText");
  }
  const usageNote = text(input.usageNote);
  if (usageNote.length > 500) {
    throw new ContentError("Shorten the usage note (500 characters at most).", "usageNote");
  }
  const tags = [
    ...new Set(
      (typeof input.tags === "string" ? input.tags.split(",") : [])
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
  if (tags.length > 20 || tags.some((tag) => tag.length > 40)) {
    throw new ContentError("Use up to 20 tags, separated by commas, 40 characters each.", "tags");
  }
  return { title, altText, usageNote, tags };
}

/** Stores the file (photo or video) and its asset row. */
async function storeFile(
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
        throw new ContentError(
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
      throw new ContentError(
        error.problem === "too_large"
          ? "The video is too large (8 MB at most)."
          : error.problem === "empty"
            ? "Choose a photo or video."
            : "Upload a photo (JPEG, PNG or WebP) or a video (MP4 or MOV).",
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

/** Adds a photo or video to the library. */
export async function addLibraryFile(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  bytes: Uint8Array,
  input: { title: unknown; altText?: unknown; tags?: unknown; usageNote?: unknown },
): Promise<{ id: string }> {
  assertPermission(context, "content.write");
  const text = cleanText(input);
  const stored = await storeFile(db, deps, bytes, context.userId);
  try {
    const row = await db.run(async (tx) => {
      const created = await tx.contentAsset.create({
        data: {
          tenantId: db.tenantId,
          mediaAssetId: stored.assetId,
          ...text,
          createdByUserId: context.userId,
        },
        select: { id: true },
      });
      await audit(
        tx,
        context,
        "content.asset_added",
        { type: "content_asset", id: created.id },
        undefined,
        {
          kind: stored.kind,
        },
      );
      return created;
    });
    if (stored.kind === "image") {
      await requestProcessing(deps, { tenantId: db.tenantId, assetId: stored.assetId });
    }
    return row;
  } catch (error) {
    await db.run((tx) => tx.mediaAsset.deleteMany({ where: { id: stored.assetId } }));
    await deleteStoredFiles(deps, stored.keys);
    throw error;
  }
}

export async function updateLibraryFile(
  db: TenantDb,
  context: RequestContext,
  id: string,
  input: {
    title: unknown;
    altText?: unknown;
    tags?: unknown;
    usageNote?: unknown;
    archived?: unknown;
  },
): Promise<void> {
  assertPermission(context, "content.write");
  assertUuid(id, "library file");
  const text = cleanText(input);
  const archived = input.archived === true || input.archived === "on";
  await db.run(async (tx) => {
    const before = await tx.contentAsset.findUnique({
      where: { id },
      select: { archivedAt: true },
    });
    if (!before) throw new NotFoundError("library file");
    await tx.contentAsset.update({
      where: { id },
      data: { ...text, archivedAt: archived ? (before.archivedAt ?? new Date()) : null },
    });
    await audit(tx, context, "content.asset_updated", { type: "content_asset", id }, undefined, {
      archived,
    });
  });
}

/** The library, newest first; archived files only when asked for. */
export async function listLibrary(
  db: TenantDb,
  context: RequestContext,
  input: { search?: string; tag?: string; archived?: boolean } = {},
): Promise<LibraryItem[]> {
  assertPermission(context, "content.write");
  const search = (input.search ?? "").trim().slice(0, 100);
  const tag = (input.tag ?? "").trim().toLowerCase().slice(0, 40);
  const rows = await db.run((tx) =>
    tx.contentAsset.findMany({
      where: {
        archivedAt: input.archived ? { not: null } : null,
        ...(search ? { title: { contains: search, mode: "insensitive" as const } } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
      },
      select: SELECT,
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  );
  return rows.map((row) => toItem(row as unknown as Row));
}

export async function getLibraryFile(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<LibraryItem> {
  assertPermission(context, "content.write");
  assertUuid(id, "library file");
  const row = await db.run((tx) => tx.contentAsset.findUnique({ where: { id }, select: SELECT }));
  if (!row) throw new NotFoundError("library file");
  return toItem(row as unknown as Row);
}

/** The versions made from a library file, newest first. */
export async function listVersions(
  db: TenantDb,
  context: RequestContext,
  id: string,
): Promise<LibraryItem[]> {
  assertPermission(context, "content.write");
  assertUuid(id, "library file");
  const rows = await db.run((tx) =>
    tx.contentAsset.findMany({
      where: { derivedFromId: id },
      select: SELECT,
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
  );
  return rows.map((row) => toItem(row as unknown as Row));
}

/**
 * Makes a version of a library photo (a platform size, light correction, a
 * plain background removed) and adds it to the library as a new file linked
 * to the original, with the same tags, description and rights note. The
 * original is never changed. Photos only.
 */
export async function makeLibraryVersion(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  id: string,
  input: Record<string, unknown>,
): Promise<{ id: string; enlarged: boolean }> {
  assertPermission(context, "content.write");
  assertUuid(id, "library file");
  let options;
  try {
    options = parseEditOptions(input);
  } catch (error) {
    if (error instanceof EditError) throw new ContentError(error.message, error.field);
    throw error;
  }
  const source = await db.run((tx) =>
    tx.contentAsset.findUnique({
      where: { id },
      select: {
        id: true,
        title: true,
        altText: true,
        tags: true,
        usageNote: true,
        media: { select: { kind: true, storageKey: true } },
      },
    }),
  );
  if (!source) throw new NotFoundError("library file");
  if (source.media.kind !== "image") {
    throw new ContentError("Versions can be made from photos only, not videos.", "size");
  }

  const master = await deps.storage.get(source.media.storageKey);
  let edited;
  try {
    edited = await editImage(master, options);
  } catch (error) {
    if (error instanceof EditError) throw new ContentError(error.message, error.field);
    throw error;
  }
  let upload;
  try {
    upload = await storeUpload(db.tenantId, deps.storage, edited.body);
  } catch (error) {
    if (error instanceof ImageError) {
      throw new ContentError("This version came out too large to store. Choose a smaller size.");
    }
    throw error;
  }

  const suffix = ` · ${EDIT_SIZES[options.size].short}`;
  const title = source.title.slice(0, 120 - suffix.length) + suffix;
  try {
    const row = await db.run(async (tx) => {
      const asset = await insertAsset(tx, db.tenantId, context.userId, upload);
      const created = await tx.contentAsset.create({
        data: {
          tenantId: db.tenantId,
          mediaAssetId: asset.id,
          title,
          altText: source.altText,
          tags: source.tags,
          usageNote: source.usageNote,
          derivedFromId: source.id,
          editNote: describeEdit(options, edited.width, edited.height),
          createdByUserId: context.userId,
        },
        select: { id: true, mediaAssetId: true },
      });
      await audit(
        tx,
        context,
        "content.asset_version_made",
        { type: "content_asset", id: created.id },
        undefined,
        { from: source.id, size: options.size, removeBackground: options.removeBackground },
      );
      return created;
    });
    await requestProcessing(deps, { tenantId: db.tenantId, assetId: row.mediaAssetId });
    return { id: row.id, enlarged: edited.enlarged };
  } catch (error) {
    await deleteStoredFiles(deps, [upload.storageKey]);
    throw error;
  }
}
