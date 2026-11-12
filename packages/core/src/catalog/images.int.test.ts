import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { makeTestImage } from "@ecom/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { seedSystemData } from "../identity/seed";
import {
  imageView,
  markMediaAssetFailed,
  processMediaAsset,
  type MediaDeps,
  type MediaProcessingJob,
} from "../media/assets";
import { sniffImageType } from "../media/image";
import { listUnprocessedMedia } from "../platform/media-sweep";
import { createMemoryStorage, createS3Storage, type MemoryStorage } from "../storage/storage";
import { createBrand } from "./brands";
import { createCategory } from "./categories";
import { CatalogError, type CatalogErrorCode } from "./errors";
import {
  addProductImage,
  getBrandLogo,
  getCategoryImage,
  listProductImages,
  MAX_PRODUCT_IMAGES,
  moveProductImage,
  removeBrandLogo,
  removeCategoryImage,
  removeProductImage,
  setBrandLogo,
  setCategoryImage,
  updateProductImage,
} from "./images";
import { addVariant, createProduct, listProducts } from "./products";

// Catalog images against the real (test) database on the runtime connection,
// so Row-Level Security is in force. Files go to an in-memory store, except
// in the last block, which talks to the local S3-compatible service.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);

interface Actor {
  context: RequestContext;
  db: TenantDb;
}

const tenantIds: string[] = [];
const userIds: string[] = [];

async function createTenant(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Images ${label} ${run}`, slug: `images-${label}-${run}` },
  });
  const store = await admin.store.create({
    data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main" },
  });
  tenantIds.push(tenant.id);
  return { tenantId: tenant.id, storeId: store.id };
}

async function createActor(
  tenant: { tenantId: string; storeId: string },
  role: SystemRoleKey,
): Promise<Actor> {
  const user = await admin.user.create({
    data: { email: `images-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId: tenant.tenantId, roleId: roleRow.id },
  });
  const permissions = SYSTEM_ROLES.find((r) => r.key === role)!.permissions;
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.30",
    userId: user.id,
    isPlatformAdmin: false,
    tenantId: tenant.tenantId,
    tenantSlug: "x",
    tenantName: "x",
    storeId: tenant.storeId,
    roleKey: role,
    roleName: role,
    permissions: new Set<PermissionKey>(permissions as readonly PermissionKey[]),
  };
  return { context, db: createTenantDb(app, context) };
}

async function expectCatalogError(work: Promise<unknown>, code: CatalogErrorCode) {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error, `expected CatalogError ${code}`).toBeInstanceOf(CatalogError);
  expect((error as CatalogError).code).toBe(code);
}

let storage: MemoryStorage;
let queued: MediaProcessingJob[];
let warnings: string[];
let deps: MediaDeps;

let owner: Actor; // tenant A, can read and write
let marketer: Actor; // tenant A, read only
let other: Actor; // tenant B owner
let tenantA: { tenantId: string; storeId: string };
let tenantB: { tenantId: string; storeId: string };
let photo: Buffer;

async function newProduct(actor: Actor = owner) {
  return createProduct(actor.db, actor.context, { name: `Bag ${randomUUID().slice(0, 8)}` });
}

beforeAll(async () => {
  await seedSystemData(admin);
  tenantA = await createTenant("a");
  tenantB = await createTenant("b");
  owner = await createActor(tenantA, "store_owner");
  marketer = await createActor(tenantA, "marketer");
  other = await createActor(tenantB, "store_owner");
  photo = await makeTestImage({ width: 900, height: 600, withLocation: true });

  storage = createMemoryStorage();
  queued = [];
  warnings = [];
  deps = {
    storage,
    enqueueProcessing: async (job) => {
      queued.push(job);
    },
    onWarning: (message) => warnings.push(message),
  };
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("product images", () => {
  it("stores a cleaned file under the tenant's prefix and queues resizing", async () => {
    const product = await newProduct();
    const before = queued.length;
    const added = await addProductImage(owner.db, owner.context, deps, product.id, {
      bytes: photo,
      altText: "  Black tote, front view ",
    });

    const [image] = await listProductImages(owner.db, owner.context, product.id);
    expect(image).toMatchObject({ id: added.id, altText: "Black tote, front view", isMain: true });
    expect(image!.image).toMatchObject({ width: 900, height: 600, status: "processing" });
    expect(image!.image.storageKey).toMatch(
      new RegExp(`^public/${tenantA.tenantId}/[0-9a-f]{32}/original\\.jpg$`),
    );

    const stored = storage.files.get(image!.image.storageKey)!;
    expect(stored.contentType).toBe("image/jpeg");
    expect(Buffer.from(stored.body).includes("TestCam"), "metadata must be removed").toBe(false);

    expect(queued.slice(before)).toEqual([{ tenantId: tenantA.tenantId, assetId: added.assetId }]);

    const row = await admin.mediaAsset.findUniqueOrThrow({ where: { id: added.assetId } });
    expect(row).toMatchObject({ uploadedBy: owner.context.userId, mimeType: "image/jpeg" });
    expect(row.bytes).toBe(stored.body.length);
    expect(row.checksum).toMatch(/^[0-9a-f]{64}$/);

    const entry = await admin.auditLog.findFirst({
      where: { tenantId: tenantA.tenantId, action: "catalog.product_image_added" },
      orderBy: { createdAt: "desc" },
    });
    expect(entry).toMatchObject({ entityId: product.id, actorUserId: owner.context.userId });
  });

  it("refuses files that are not acceptable images and stores nothing", async () => {
    const product = await newProduct();
    const filesBefore = storage.files.size;
    await expectCatalogError(
      addProductImage(owner.db, owner.context, deps, product.id, {
        bytes: Buffer.from("<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>"),
      }),
      "invalid_image",
    );
    await expectCatalogError(
      addProductImage(owner.db, owner.context, deps, product.id, { bytes: new Uint8Array() }),
      "invalid_image",
    );
    await expectCatalogError(
      addProductImage(owner.db, owner.context, deps, product.id, {
        bytes: photo,
        altText: "x".repeat(301),
      }),
      "invalid",
    );
    expect(storage.files.size).toBe(filesBefore);
    expect(await listProductImages(owner.db, owner.context, product.id)).toEqual([]);
  });

  it("lets a read-only role look but not change", async () => {
    const product = await newProduct();
    const added = await addProductImage(owner.db, owner.context, deps, product.id, {
      bytes: photo,
    });
    expect(await listProductImages(marketer.db, marketer.context, product.id)).toHaveLength(1);

    const filesBefore = storage.files.size;
    const attempts = [
      () => addProductImage(marketer.db, marketer.context, deps, product.id, { bytes: photo }),
      () => updateProductImage(marketer.db, marketer.context, added.id, { altText: "x" }),
      () => moveProductImage(marketer.db, marketer.context, added.id, "first"),
      () => removeProductImage(marketer.db, marketer.context, deps, added.id),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toBeInstanceOf(ForbiddenError);
    expect(storage.files.size).toBe(filesBefore);
  });

  it("keeps another tenant out: no reading, attaching, changing or deleting", async () => {
    const product = await newProduct();
    const added = await addProductImage(owner.db, owner.context, deps, product.id, {
      bytes: photo,
      altText: "Ours",
    });
    const filesBefore = storage.files.size;

    const attempts = [
      () => listProductImages(other.db, other.context, product.id),
      () => addProductImage(other.db, other.context, deps, product.id, { bytes: photo }),
      () => updateProductImage(other.db, other.context, added.id, { altText: "Theirs" }),
      () => moveProductImage(other.db, other.context, added.id, "first"),
      () => removeProductImage(other.db, other.context, deps, added.id),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);

    expect(storage.files.size, "no file stored or removed").toBe(filesBefore);
    const [image] = await listProductImages(owner.db, owner.context, product.id);
    expect(image).toMatchObject({ id: added.id, altText: "Ours" });

    // Underneath the services, the database itself refuses.
    const theirProduct = await newProduct(other);
    const asOther = { tenantId: tenantB.tenantId };
    expect(await withTenant(app, asOther, (tx) => tx.mediaAsset.count())).toBe(0);
    expect(await withTenant(app, asOther, (tx) => tx.productImage.count())).toBe(0);
    expect(
      await withTenant(app, asOther, (tx) =>
        tx.mediaAsset.deleteMany({ where: { id: added.assetId } }),
      ),
    ).toEqual({ count: 0 });
    // Tenant B cannot attach tenant A's file to its own product...
    await expect(
      withTenant(app, asOther, (tx) =>
        tx.productImage.create({
          data: {
            tenantId: tenantB.tenantId,
            productId: theirProduct.id,
            mediaAssetId: added.assetId,
          },
        }),
      ),
    ).rejects.toThrow();
    // ...nor register a file that sits under tenant A's prefix as its own.
    await expect(
      withTenant(app, asOther, (tx) =>
        tx.mediaAsset.create({
          data: {
            tenantId: tenantB.tenantId,
            storageKey: `public/${tenantA.tenantId}/stolen/original.jpg`,
            mimeType: "image/jpeg",
            bytes: 10,
            width: 10,
            height: 10,
            checksum: "a".repeat(64),
          },
        }),
      ),
    ).rejects.toThrow();
  });

  it("orders images, and the first one is the main image", async () => {
    const product = await newProduct();
    const ids: string[] = [];
    for (const altText of ["one", "two", "three"]) {
      const { id } = await addProductImage(owner.db, owner.context, deps, product.id, {
        bytes: photo,
        altText,
      });
      ids.push(id);
    }
    const order = async () =>
      (await listProductImages(owner.db, owner.context, product.id)).map((i) => i.altText);

    expect(await order()).toEqual(["one", "two", "three"]);
    await moveProductImage(owner.db, owner.context, ids[2]!, "earlier");
    expect(await order()).toEqual(["one", "three", "two"]);
    await moveProductImage(owner.db, owner.context, ids[0]!, "later");
    expect(await order()).toEqual(["three", "one", "two"]);
    await moveProductImage(owner.db, owner.context, ids[1]!, "first");
    expect(await order()).toEqual(["two", "three", "one"]);
    // Moving past either end changes nothing.
    await moveProductImage(owner.db, owner.context, ids[1]!, "earlier");
    await moveProductImage(owner.db, owner.context, ids[0]!, "later");
    expect(await order()).toEqual(["two", "three", "one"]);

    const images = await listProductImages(owner.db, owner.context, product.id);
    expect(images.map((image) => image.isMain)).toEqual([true, false, false]);

    const list = await listProducts(owner.db, owner.context, { search: product.id });
    expect(list.items).toEqual([]);
    const all = await listProducts(owner.db, owner.context);
    const summary = all.items.find((item) => item.id === product.id);
    expect(summary?.mainImage).toMatchObject({ altText: "two" });
  });

  it("ties an image to a variant of the same product only", async () => {
    const product = await newProduct();
    const elsewhere = await newProduct();
    const variant = await addVariant(owner.db, owner.context, product.id, {
      sku: `IMG-${randomUUID().slice(0, 8)}`,
      priceAmount: 1000,
    });
    const foreign = await addVariant(owner.db, owner.context, elsewhere.id, {
      sku: `IMG-${randomUUID().slice(0, 8)}`,
      priceAmount: 1000,
    });
    const { id } = await addProductImage(owner.db, owner.context, deps, product.id, {
      bytes: photo,
    });

    await updateProductImage(owner.db, owner.context, id, {
      altText: "Black",
      variantId: variant.id,
    });
    let [image] = await listProductImages(owner.db, owner.context, product.id);
    expect(image).toMatchObject({ altText: "Black", variantId: variant.id });

    await expectCatalogError(
      updateProductImage(owner.db, owner.context, id, { variantId: foreign.id }),
      "unknown_reference",
    );
    // The database enforces the same rule.
    await expect(
      withTenant(app, { tenantId: tenantA.tenantId }, (tx) =>
        tx.productImage.update({ where: { id }, data: { variantId: foreign.id } }),
      ),
    ).rejects.toThrow();

    await updateProductImage(owner.db, owner.context, id, { altText: "Black", variantId: "" });
    [image] = await listProductImages(owner.db, owner.context, product.id);
    expect(image?.variantId).toBeNull();
  });

  it("removes an image together with all of its files", async () => {
    const product = await newProduct();
    const keep = await addProductImage(owner.db, owner.context, deps, product.id, { bytes: photo });
    const drop = await addProductImage(owner.db, owner.context, deps, product.id, { bytes: photo });
    await processMediaAsset(
      createTenantDb(app, { tenantId: tenantA.tenantId }),
      storage,
      drop.assetId,
    );

    const images = await listProductImages(owner.db, owner.context, product.id);
    const dropped = images.find((image) => image.id === drop.id)!;
    const droppedKeys = [dropped.image.storageKey, ...dropped.image.variants.map((v) => v.key)];
    expect(droppedKeys.length).toBeGreaterThan(1);
    for (const key of droppedKeys) expect(storage.files.has(key)).toBe(true);

    await removeProductImage(owner.db, owner.context, deps, drop.id);
    for (const key of droppedKeys) expect(storage.files.has(key)).toBe(false);
    expect(await admin.mediaAsset.findUnique({ where: { id: drop.assetId } })).toBeNull();

    const left = await listProductImages(owner.db, owner.context, product.id);
    expect(left.map((image) => image.id)).toEqual([keep.id]);
    expect(storage.files.has(left[0]!.image.storageKey)).toBe(true);
  });

  it("still removes the image when storage is unreachable, and reports it", async () => {
    const product = await newProduct();
    const { id } = await addProductImage(owner.db, owner.context, deps, product.id, {
      bytes: photo,
    });
    const failing: MediaDeps = {
      ...deps,
      storage: {
        ...storage,
        delete: async () => {
          throw new Error("storage down");
        },
      },
    };
    const before = warnings.length;
    await removeProductImage(owner.db, owner.context, failing, id);
    expect(await listProductImages(owner.db, owner.context, product.id)).toEqual([]);
    expect(warnings.length).toBe(before + 1);
  });

  it("succeeds when the queue is unreachable; the sweep finds the asset later", async () => {
    const product = await newProduct();
    const offline: MediaDeps = {
      ...deps,
      enqueueProcessing: async () => {
        throw new Error("redis down");
      },
    };
    const added = await addProductImage(owner.db, owner.context, offline, product.id, {
      bytes: photo,
    });
    expect(await listProductImages(owner.db, owner.context, product.id)).toHaveLength(1);

    expect(await listUnprocessedMedia(env.DATABASE_ADMIN_URL, 60_000, 500)).not.toContainEqual({
      tenantId: tenantA.tenantId,
      assetId: added.assetId,
    });
    await admin.mediaAsset.update({
      where: { id: added.assetId },
      data: { createdAt: new Date(Date.now() - 10 * 60_000) },
    });
    expect(await listUnprocessedMedia(env.DATABASE_ADMIN_URL, 60_000, 500)).toContainEqual({
      tenantId: tenantA.tenantId,
      assetId: added.assetId,
    });
  });

  it(`allows ${MAX_PRODUCT_IMAGES} images per product and no more`, async () => {
    const product = await newProduct();
    const small = await makeTestImage({ width: 60, height: 60 });
    for (let count = 0; count < MAX_PRODUCT_IMAGES; count += 1) {
      await addProductImage(owner.db, owner.context, deps, product.id, { bytes: small });
    }
    const filesBefore = storage.files.size;
    await expectCatalogError(
      addProductImage(owner.db, owner.context, deps, product.id, { bytes: small }),
      "too_many_images",
    );
    expect(storage.files.size).toBe(filesBefore);
  }, 60_000);
});

describe("resized versions", () => {
  it("are made inside the asset's tenant and marked ready", async () => {
    const product = await newProduct();
    const added = await addProductImage(owner.db, owner.context, deps, product.id, {
      bytes: photo,
    });
    const worker = createTenantDb(app, { tenantId: tenantA.tenantId });

    expect(await processMediaAsset(worker, storage, added.assetId)).toBe("ready");
    const [image] = await listProductImages(owner.db, owner.context, product.id);
    expect(image!.image.status).toBe("ready");
    expect(image!.image.variants.map((variant) => variant.width)).toEqual([320, 640]);
    for (const variant of image!.image.variants) {
      expect(variant.key.startsWith(`public/${tenantA.tenantId}/`)).toBe(true);
      expect(sniffImageType(storage.files.get(variant.key)!.body)).toBe("webp");
    }

    const view = imageView(storage, image!.image);
    expect(view.thumbnailUrl).toMatch(/\/w320\.webp$/);
    expect(view.srcSet).toMatch(/w320\.webp 320w, .*w640\.webp 640w$/);
    expect(view.url).toMatch(/\/original\.jpg$/);

    // Running again is harmless.
    expect(await processMediaAsset(worker, storage, added.assetId)).toBe("already_ready");
  });

  it("cannot be run for an asset from inside another tenant", async () => {
    const product = await newProduct();
    const added = await addProductImage(owner.db, owner.context, deps, product.id, {
      bytes: photo,
    });
    const wrongTenant = createTenantDb(app, { tenantId: tenantB.tenantId });
    const filesBefore = storage.files.size;
    expect(await processMediaAsset(wrongTenant, storage, added.assetId)).toBe("missing");
    await markMediaAssetFailed(wrongTenant, added.assetId, "nope");
    expect(storage.files.size).toBe(filesBefore);
    const row = await admin.mediaAsset.findUniqueOrThrow({ where: { id: added.assetId } });
    expect(row.status).toBe("processing");
  });

  it("records a failure without losing the uploaded image", async () => {
    const product = await newProduct();
    const added = await addProductImage(owner.db, owner.context, deps, product.id, {
      bytes: photo,
    });
    const worker = createTenantDb(app, { tenantId: tenantA.tenantId });
    await markMediaAssetFailed(worker, added.assetId, "decoder crashed");
    const [image] = await listProductImages(owner.db, owner.context, product.id);
    expect(image!.image.status).toBe("failed");
    const view = imageView(storage, image!.image);
    expect(view.thumbnailUrl).toBe(view.url);
    expect(view.srcSet).toBe("");
  });
});

describe("category image and brand logo", () => {
  it("sets, replaces and removes a category image", async () => {
    const category = await createCategory(owner.db, owner.context, {
      name: `Cat ${randomUUID().slice(0, 8)}`,
    });
    expect(await getCategoryImage(owner.db, owner.context, category.id)).toBeNull();

    await setCategoryImage(owner.db, owner.context, deps, category.id, photo);
    const first = await getCategoryImage(owner.db, owner.context, category.id);
    expect(first).toMatchObject({ width: 900, height: 600 });
    expect(storage.files.has(first!.storageKey)).toBe(true);

    await setCategoryImage(
      owner.db,
      owner.context,
      deps,
      category.id,
      await makeTestImage({ width: 300, height: 300 }),
    );
    const second = await getCategoryImage(owner.db, owner.context, category.id);
    expect(second).toMatchObject({ width: 300, height: 300 });
    expect(storage.files.has(first!.storageKey), "the old file is removed").toBe(false);
    expect(await admin.mediaAsset.findUnique({ where: { id: first!.assetId } })).toBeNull();

    await removeCategoryImage(owner.db, owner.context, deps, category.id);
    expect(await getCategoryImage(owner.db, owner.context, category.id)).toBeNull();
    expect(storage.files.has(second!.storageKey)).toBe(false);
    // Removing when there is nothing to remove is not an error.
    await removeCategoryImage(owner.db, owner.context, deps, category.id);
  });

  it("keeps a transparent brand logo as PNG", async () => {
    const brand = await createBrand(owner.db, owner.context, {
      name: `Brand ${randomUUID().slice(0, 8)}`,
    });
    await setBrandLogo(
      owner.db,
      owner.context,
      deps,
      brand.id,
      await makeTestImage({ width: 200, height: 80, format: "png", transparent: true }),
    );
    const logo = await getBrandLogo(owner.db, owner.context, brand.id);
    expect(logo?.storageKey).toMatch(/original\.png$/);
    await removeBrandLogo(owner.db, owner.context, deps, brand.id);
    expect(await getBrandLogo(owner.db, owner.context, brand.id)).toBeNull();
  });

  it("is closed to read-only roles and to other tenants", async () => {
    const category = await createCategory(owner.db, owner.context, {
      name: `Cat ${randomUUID().slice(0, 8)}`,
    });
    const brand = await createBrand(owner.db, owner.context, {
      name: `Brand ${randomUUID().slice(0, 8)}`,
    });
    await setCategoryImage(owner.db, owner.context, deps, category.id, photo);
    await setBrandLogo(owner.db, owner.context, deps, brand.id, photo);
    const filesBefore = storage.files.size;

    const forbidden = [
      () => setCategoryImage(marketer.db, marketer.context, deps, category.id, photo),
      () => removeCategoryImage(marketer.db, marketer.context, deps, category.id),
      () => setBrandLogo(marketer.db, marketer.context, deps, brand.id, photo),
      () => removeBrandLogo(marketer.db, marketer.context, deps, brand.id),
    ];
    for (const attempt of forbidden) await expect(attempt()).rejects.toBeInstanceOf(ForbiddenError);

    const hidden = [
      () => getCategoryImage(other.db, other.context, category.id),
      () => setCategoryImage(other.db, other.context, deps, category.id, photo),
      () => removeCategoryImage(other.db, other.context, deps, category.id),
      () => getBrandLogo(other.db, other.context, brand.id),
      () => setBrandLogo(other.db, other.context, deps, brand.id, photo),
      () => removeBrandLogo(other.db, other.context, deps, brand.id),
    ];
    for (const attempt of hidden) await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);

    expect(storage.files.size).toBe(filesBefore);
    expect(await getCategoryImage(owner.db, owner.context, category.id)).not.toBeNull();
    expect(await getBrandLogo(owner.db, owner.context, brand.id)).not.toBeNull();

    // Tenant B cannot point its own category at tenant A's file.
    const theirs = await createCategory(other.db, other.context, { name: "Theirs" });
    const ours = await getCategoryImage(owner.db, owner.context, category.id);
    await expect(
      withTenant(app, { tenantId: tenantB.tenantId }, (tx) =>
        tx.category.update({ where: { id: theirs.id }, data: { imageAssetId: ours!.assetId } }),
      ),
    ).rejects.toThrow();
  });
});

describe("S3-compatible storage (local service)", () => {
  const s3 = createS3Storage(env);
  const folder = `public/${randomUUID()}/test-${run}`;

  it("serves public files by address, with their type, and deletes them", async () => {
    const key = `${folder}/original.jpg`;
    const body = new Uint8Array(await makeTestImage({ width: 60, height: 60 }));
    await s3.put(key, body, { contentType: "image/jpeg" });

    expect(Buffer.from(await s3.get(key)).equals(Buffer.from(body))).toBe(true);
    const response = await fetch(s3.publicUrl(key));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("immutable");
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(body))).toBe(true);

    await s3.delete([key, `${folder}/never-existed.webp`]);
    expect((await fetch(s3.publicUrl(key))).status).toBe(404);
  });

  it("does not let anyone list the bucket or read outside the public area", async () => {
    const base = env.S3_PUBLIC_URL.replace(/\/+$/, "");
    expect((await fetch(`${base}?list-type=2`)).status).toBe(403);
    expect((await fetch(`${base}/`)).status).toBe(403);

    const key = `private-test/${run}.txt`;
    await s3.put(key, new TextEncoder().encode("secret"), { contentType: "text/plain" });
    try {
      expect((await fetch(`${base}/${key}`)).status).toBe(403);
    } finally {
      await s3.delete([key]);
    }
  });

  it("refuses keys that could escape the intended folder", async () => {
    const body = new Uint8Array([1]);
    for (const key of ["../x", "public/../x", "/public/x", "public//x", "public/a b"]) {
      await expect(s3.put(key, body, { contentType: "image/jpeg" })).rejects.toThrow(/invalid/);
    }
  });
});
