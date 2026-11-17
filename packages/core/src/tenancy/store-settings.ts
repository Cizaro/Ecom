import type { AppTransaction, Prisma } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { normalizeEmail } from "../customers/accounts";
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
import { ImageError } from "../media/image";
import { safeTimeZone } from "../platform/time";
import {
  BRANDING_PRESETS,
  contrastRatio,
  CORNER_STYLES,
  FONT_STYLES,
  normalizeHex,
  parseBranding,
  type StoreBranding,
} from "./branding";

// A store's own settings: its name, time zone, contact details and look.
// Staff with settings.write change them; every change is audited. The
// storefront reads them for the store it is serving (see store-host.ts).

export class StoreSettingsError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "StoreSettingsError";
  }
}

export interface StoreSettingsView {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  branding: StoreBranding;
  logo: StoredImage | null;
}

const SELECT = {
  id: true,
  name: true,
  timezone: true,
  defaultCurrency: true,
  branding: true,
  logo: { select: ASSET_SELECT },
} as const;

async function storeIn(tx: AppTransaction) {
  const store = await tx.store.findFirst({ select: SELECT, orderBy: { createdAt: "asc" } });
  if (!store) throw new NotFoundError("store");
  return store;
}

const toView = (store: Awaited<ReturnType<typeof storeIn>>): StoreSettingsView => ({
  id: store.id,
  name: store.name,
  timezone: safeTimeZone(store.timezone),
  currency: store.defaultCurrency,
  branding: parseBranding(store.branding),
  logo: store.logo ? toStoredImage(store.logo) : null,
});

export async function getStoreSettings(
  db: TenantDb,
  context: RequestContext,
): Promise<StoreSettingsView> {
  assertPermission(context, "settings.write");
  return toView(await db.run(storeIn));
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The store's name, time zone and what shoppers see about contacting it. */
export async function updateStoreDetails(
  db: TenantDb,
  context: RequestContext,
  input: {
    name: unknown;
    timezone: unknown;
    tagline?: unknown;
    contactEmail?: unknown;
    contactPhone?: unknown;
  },
): Promise<void> {
  assertPermission(context, "settings.write");
  const name = text(input.name).replace(/\s+/g, " ");
  if (!name) throw new StoreSettingsError("Enter the store's name.", "name");
  if (name.length > 100) {
    throw new StoreSettingsError("Shorten the name (100 characters at most).", "name");
  }
  const timezone = text(input.timezone);
  if (!timezone || safeTimeZone(timezone) !== timezone) {
    throw new StoreSettingsError("Choose a time zone from the list.", "timezone");
  }
  const tagline = text(input.tagline).replace(/\s+/g, " ");
  if (tagline.length > 160) {
    throw new StoreSettingsError("Shorten the tagline (160 characters at most).", "tagline");
  }
  const emailText = text(input.contactEmail);
  const contactEmail = emailText === "" ? "" : normalizeEmail(emailText);
  if (contactEmail === null) {
    throw new StoreSettingsError("Enter a valid contact email, or leave it empty.", "contactEmail");
  }
  const contactPhone = text(input.contactPhone);
  if (contactPhone && !/^[+\d][\d\s().-]{4,38}$/.test(contactPhone)) {
    throw new StoreSettingsError("Enter a valid contact phone, or leave it empty.", "contactPhone");
  }
  await db.run(async (tx) => {
    const store = await storeIn(tx);
    const branding = { ...parseBranding(store.branding), tagline, contactEmail, contactPhone };
    await tx.store.update({
      where: { id: store.id },
      data: { name, timezone, branding: branding as unknown as Prisma.InputJsonObject },
    });
    await audit(
      tx,
      context,
      "settings.store_details_updated",
      { type: "store", id: store.id },
      { name: store.name, timezone: store.timezone },
      { name, timezone },
    );
  });
}

/** The store's colours, corners and font. A preset key fills them in. */
export async function updateStoreBranding(
  db: TenantDb,
  context: RequestContext,
  input: {
    preset?: unknown;
    brandColor?: unknown;
    accentColor?: unknown;
    corners?: unknown;
    font?: unknown;
  },
): Promise<void> {
  assertPermission(context, "settings.write");
  const preset = BRANDING_PRESETS.find((item) => item.key === input.preset);
  const brandColor = preset?.branding.brandColor ?? normalizeHex(input.brandColor);
  if (!brandColor) {
    throw new StoreSettingsError("Choose the main colour (like #1c1917).", "brandColor");
  }
  const accentColor = preset?.branding.accentColor ?? normalizeHex(input.accentColor);
  if (!accentColor) {
    throw new StoreSettingsError("Choose the accent colour (like #b45309).", "accentColor");
  }
  // The accent is used for text on white (sale prices): it has to be readable.
  if (contrastRatio(accentColor, "#ffffff") < 4.5) {
    throw new StoreSettingsError(
      "The accent colour is too light to read on a white page. Choose a darker one.",
      "accentColor",
    );
  }
  const corners =
    preset?.branding.corners ?? CORNER_STYLES.find((style) => style === input.corners);
  if (!corners) throw new StoreSettingsError("Choose a corner style.", "corners");
  const font = preset?.branding.font ?? FONT_STYLES.find((style) => style === input.font);
  if (!font) throw new StoreSettingsError("Choose a font.", "font");

  await db.run(async (tx) => {
    const store = await storeIn(tx);
    const before = parseBranding(store.branding);
    const branding = { ...before, brandColor, accentColor, corners, font };
    await tx.store.update({
      where: { id: store.id },
      data: { branding: branding as unknown as Prisma.InputJsonObject },
    });
    await audit(
      tx,
      context,
      "settings.store_branding_updated",
      { type: "store", id: store.id },
      {
        brandColor: before.brandColor,
        accentColor: before.accentColor,
        corners: before.corners,
        font: before.font,
      },
      { brandColor, accentColor, corners, font },
    );
  });
}

/** Sets or replaces the store's logo. Throws StoreSettingsError for an unusable image. */
export async function setStoreLogo(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
  bytes: Uint8Array,
): Promise<void> {
  assertPermission(context, "settings.write");
  let upload;
  try {
    upload = await storeUpload(db.tenantId, deps.storage, bytes);
  } catch (error) {
    if (error instanceof ImageError) {
      throw new StoreSettingsError(
        error.problem === "too_large"
          ? "The logo file is too large (8 MB at most)."
          : "Use a JPEG, PNG or WebP image at least 50 pixels on each side for the logo.",
        "logo",
      );
    }
    throw error;
  }
  let result: { assetId: string; oldKeys: string[] };
  try {
    result = await db.run(async (tx) => {
      const store = await storeIn(tx);
      const previous = store.logo ? toStoredImage(store.logo) : null;
      const asset = await insertAsset(tx, db.tenantId, context.userId, upload);
      await tx.store.update({ where: { id: store.id }, data: { logoAssetId: asset.id } });
      if (previous) await tx.mediaAsset.delete({ where: { id: previous.assetId } });
      await audit(tx, context, "settings.store_logo_set", { type: "store", id: store.id });
      return { assetId: asset.id, oldKeys: previous ? storedKeys(previous) : [] };
    });
  } catch (error) {
    await deleteStoredFiles(deps, [upload.storageKey]);
    throw error;
  }
  await deleteStoredFiles(deps, result.oldKeys);
  await requestProcessing(deps, { tenantId: db.tenantId, assetId: result.assetId });
}

export async function removeStoreLogo(
  db: TenantDb,
  context: RequestContext,
  deps: MediaDeps,
): Promise<void> {
  assertPermission(context, "settings.write");
  const keys = await db.run(async (tx) => {
    const store = await storeIn(tx);
    if (!store.logo) return [];
    const previous = toStoredImage(store.logo);
    // The link is cleared by the database when the asset goes.
    await tx.mediaAsset.delete({ where: { id: previous.assetId } });
    await audit(tx, context, "settings.store_logo_removed", { type: "store", id: store.id });
    return storedKeys(previous);
  });
  await deleteStoredFiles(deps, keys);
}
