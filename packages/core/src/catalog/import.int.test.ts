import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { makeTestImage } from "@ecom/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { createMemoryStorage } from "../storage/storage";
import {
  checkProductImport,
  getProductImport,
  ImportError,
  processImportImages,
  runProductImport,
} from "./import";

// Product import against the real (test) database on the runtime connection,
// with pictures served by a small local web server.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

let server: Server;
let base = "";

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Import ${label} ${run}`, slug: `imp-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  await admin.category.create({ data: { tenantId: tenant.id, name: "Bags", slug: "bags" } });
  await admin.brand.create({ data: { tenantId: tenant.id, name: "Cedar", slug: "cedar" } });
  return {
    tenantId: tenant.id,
    shop: createTenantDb(app, { tenantId: tenant.id }),
    owner: await staff(tenant.id, "store_owner"),
  };
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `imp-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.65",
    userId: user.id,
    isPlatformAdmin: false,
    tenantId,
    tenantSlug: "x",
    tenantName: "x",
    storeId: null,
    roleKey: role,
    roleName: role,
    permissions: new Set<PermissionKey>(
      SYSTEM_ROLES.find((r) => r.key === role)!.permissions as readonly PermissionKey[],
    ),
  };
  return { context, db: createTenantDb(app, context) };
}

const csv = (lines: string[]) => new TextEncoder().encode(lines.join("\n"));
const HEADER =
  "Product name,Category,Brand,Description,Colour,Size,SKU,Price,Sale price,Stock,Picture links";

beforeAll(async () => {
  const photo = await makeTestImage({ width: 400, height: 400, format: "png" });
  server = createServer((request, response) => {
    if (request.url === "/tote.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end(photo);
    } else if (request.url === "/not-an-image.png") {
      response.writeHead(200, { "content-type": "image/png" });
      response.end("hello");
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server.close();
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("checking a file", () => {
  it("lists every problem by row and column, and nothing is created", async () => {
    const s = await store("problems");
    await admin.product
      .create({ data: { tenantId: s.tenantId, name: "Old", slug: "old", status: "draft" } })
      .then((p) =>
        admin.productVariant.create({
          data: {
            tenantId: s.tenantId,
            productId: p.id,
            sku: "TAKEN-1",
            priceAmount: 100,
            currency: "USD",
          },
        }),
      );
    const { id } = await checkProductImport(s.owner.db, s.owner.context, {
      fileName: "mine.csv",
      bytes: csv([
        HEADER,
        "Tote,Shoes,,,,,T-1,40,,,",
        "Wallet,Bags,Nobody,,,,TAKEN-1,abc,,,",
        "Clutch,Bags,,,,,T-1,30,35,,not-a-link",
        ",Bags,,,,,T-9,10,,,",
      ]),
    });
    const result = await getProductImport(s.owner.db, s.owner.context, id);
    expect(result.status).toBe("checked");
    expect(result.problems.map((p) => `${p.row} ${p.column}`)).toEqual([
      "2 Category",
      "3 Brand",
      "3 SKU",
      "3 Price",
      "4 Picture links",
      "4 SKU",
      "4 Sale price",
      "5 Product name",
    ]);
    expect(result.problems[0]!.message).toMatch(/no category called "Shoes"/);
    // A file with problems cannot be imported.
    await expect(
      runProductImport(s.owner.db, s.owner.context, id, { publish: false }),
    ).rejects.toThrow(ImportError);
    expect(await admin.product.count({ where: { tenantId: s.tenantId } })).toBe(1);
  });
});

describe("importing", () => {
  it("creates products with their variants, stock and pictures, once", async () => {
    const s = await store("import");
    const { id } = await checkProductImport(s.owner.db, s.owner.context, {
      fileName: "spring.csv",
      bytes: csv([
        HEADER,
        `Leather Tote,bags,Cedar,Soft leather.,Sand,,TOTE-S,40,35,5,"${base}/tote.png, ${base}/missing.png"`,
        "Leather Tote,,,,Black,,TOTE-B,40,,0,",
        `Card Holder,Bags,,,,,CARD-1,15,,,${base}/not-an-image.png`,
      ]),
    });
    const checked = await getProductImport(s.owner.db, s.owner.context, id);
    expect(checked).toMatchObject({
      problems: [],
      productCount: 2,
      variantCount: 3,
      imageCount: 3,
    });

    await runProductImport(s.owner.db, s.owner.context, id, { publish: true });
    await expect(
      runProductImport(s.owner.db, s.owner.context, id, { publish: true }),
    ).rejects.toThrow("already been imported");

    const tote = await admin.product.findFirstOrThrow({
      where: { tenantId: s.tenantId, name: "Leather Tote" },
      include: { variants: { orderBy: { position: "asc" } }, category: true, brand: true },
    });
    expect(tote).toMatchObject({
      status: "active",
      slug: "leather-tote",
      description: "Soft leather.",
    });
    expect(tote.category?.name).toBe("Bags");
    expect(tote.brand?.name).toBe("Cedar");
    expect(
      tote.variants.map((v) => [
        v.sku,
        v.color,
        v.priceAmount,
        v.discountPriceAmount,
        v.trackInventory,
      ]),
    ).toEqual([
      ["TOTE-S", "Sand", 4000, 3500, true],
      ["TOTE-B", "Black", 4000, null, true],
    ]);
    const level = await admin.inventoryLevel.findFirstOrThrow({
      where: { variantId: tote.variants[0]!.id },
    });
    expect(level.onHand).toBe(5);
    const card = await admin.productVariant.findFirstOrThrow({
      where: { tenantId: s.tenantId, sku: "CARD-1" },
    });
    expect(card.trackInventory).toBe(false);

    // Pictures: the good link is added; a missing one and a non-image are reported.
    const storage = createMemoryStorage();
    const result = await processImportImages(s.shop, { storage }, { allowPrivateHosts: true });
    expect(result).toEqual({ done: 1, failed: 2 });
    const images = await admin.productImage.findMany({ where: { productId: tote.id } });
    expect(images).toHaveLength(1);
    expect(storage.files.size).toBe(1);
    const summary = await getProductImport(s.owner.db, s.owner.context, id);
    expect(summary.images).toEqual({ pending: 0, done: 1, failed: 2 });
    expect(summary.failedImages.map((f) => f.error).sort()).toEqual([
      "The picture link answered with status 404.",
      "The picture link did not give a JPEG, PNG or WebP image.",
    ]);
  });

  it("never downloads from private addresses unless the tests allow it", async () => {
    const s = await store("private");
    const { id } = await checkProductImport(s.owner.db, s.owner.context, {
      fileName: "p.csv",
      bytes: csv([HEADER, `Bag,,,,,,BAG-1,10,,,${base}/tote.png`]),
    });
    await runProductImport(s.owner.db, s.owner.context, id, { publish: false });
    const result = await processImportImages(s.shop, { storage: createMemoryStorage() });
    expect(result).toEqual({ done: 0, failed: 1 });
    const summary = await getProductImport(s.owner.db, s.owner.context, id);
    expect(summary.failedImages[0]!.error).toMatch(/private address|normal web ports/);
  });

  it("is kept to the store, and needs the right permissions", async () => {
    const s = await store("perm");
    const other = await store("perm-other");
    const { id } = await checkProductImport(s.owner.db, s.owner.context, {
      fileName: "a.csv",
      bytes: csv([HEADER, "Bag,,,,,,BAG-2,10,,3,"]),
    });
    await expect(getProductImport(other.owner.db, other.owner.context, id)).rejects.toThrow(
      NotFoundError,
    );
    await expect(
      runProductImport(other.owner.db, other.owner.context, id, { publish: false }),
    ).rejects.toThrow(NotFoundError);
    const support = await staff(s.tenantId, "customer_service");
    if (!support.context.permissions.has("catalog.write")) {
      await expect(
        checkProductImport(support.db, support.context, {
          fileName: "a.csv",
          bytes: csv([HEADER]),
        }),
      ).rejects.toThrow(ForbiddenError);
    }
    // A role that can edit the catalog but not stock is told to leave Stock empty.
    for (const role of ["content_editor", "marketer"] as const) {
      const member = await staff(s.tenantId, role);
      const perms = member.context.permissions;
      if (perms.has("catalog.write") && !perms.has("inventory.adjust")) {
        const checked = await checkProductImport(member.db, member.context, {
          fileName: "b.csv",
          bytes: csv([HEADER, "Bag,,,,,,BAG-3,10,,3,"]),
        });
        const result = await getProductImport(member.db, member.context, checked.id);
        expect(result.problems[0]!.message).toMatch(/cannot set stock/);
      }
    }
    // Opening stock was recorded as received, with who did it.
    await runProductImport(s.owner.db, s.owner.context, id, { publish: false });
    const moves = await admin.stockMovement.findMany({
      where: { tenantId: s.tenantId, reason: "purchase" },
    });
    expect(moves).toHaveLength(1);
    expect(moves[0]).toMatchObject({ quantityDelta: 3, actorUserId: s.owner.context.userId });
  });
});
