import { randomBytes, randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { makeTestImage, makeTestVideo } from "@ecom/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { createMemoryStorage, type MemoryStorage } from "../storage/storage";
import {
  addStaffUgc,
  countApprovedUgc,
  listApprovedUgc,
  listMyUgc,
  listUgcForModeration,
  moderateUgc,
  productsCustomerReceived,
  removeUgc,
  shareUgc,
  UGC_PERMISSION_VERSION,
  UgcError,
  withdrawUgc,
} from "./ugc";

// Customer and creator photos and videos against the real (test) database on
// the runtime connection, so Row-Level Security and the database rules apply.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];
let storage: MemoryStorage;
let photo: Uint8Array;

async function store(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `UGC ${label} ${run}`, slug: `ugc-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Shop ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return {
    tenantId: tenant.id,
    shop: createTenantDb(app, { tenantId: tenant.id }),
    owner: await staff(tenant.id, "store_owner"),
  };
}

async function staff(tenantId: string, role: SystemRoleKey) {
  const user = await admin.user.create({
    data: { email: `ugc-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.68",
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

let orderNumber = 7000;
/** A customer who has received a product (or not yet, when `sent` is false). */
async function buyer(tenantId: string, sent = true) {
  const tag = randomUUID().slice(0, 8);
  const product = await admin.product.create({
    data: { tenantId, name: `Tote ${tag}`, slug: `tote-${tag}`, status: "active" },
  });
  const variant = await admin.productVariant.create({
    data: { tenantId, productId: product.id, sku: `T-${tag}`, priceAmount: 1000, currency: "USD" },
  });
  const customer = await admin.customer.create({
    data: { tenantId, email: `c-${tag}@example.test`, name: "Maya Khoury" },
  });
  orderNumber += 1;
  const order = await admin.order.create({
    data: {
      tenantId,
      number: orderNumber,
      status: "confirmed",
      paymentMethod: "cash_on_delivery",
      customerId: customer.id,
      email: customer.email,
      accessKeyHash: randomBytes(32).toString("hex"),
      currency: "USD",
      subtotalAmount: 1000,
      totalAmount: 1000,
      shippingAddress: { fullName: "Maya", line1: "x", city: "Beirut", country: "LB" },
      payBy: new Date(Date.now() + 86_400_000),
      items: {
        create: [
          {
            tenantId,
            variantId: variant.id,
            productName: "Tote",
            sku: "T",
            quantity: 1,
            unitPriceAmount: 1000,
            lineTotalAmount: 1000,
          },
        ],
      },
    },
  });
  if (sent) await admin.order.update({ where: { id: order.id }, data: { status: "fulfilled" } });
  return { customer, productId: product.id };
}

beforeAll(async () => {
  storage = createMemoryStorage();
  photo = await makeTestImage({ width: 400, height: 500 });
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("customers sharing", () => {
  it("needs a received product and permission, then waits for approval", async () => {
    const s = await store("share");
    const { customer, productId } = await buyer(s.tenantId);
    const waiting = await buyer(s.tenantId, false);
    const share = (who: typeof customer, input: Record<string, unknown>) =>
      shareUgc(s.shop, { storage }, who, {
        productId,
        bytes: photo,
        permission: true,
        storeName: "Cedar Bags",
        ...input,
      });

    expect(await productsCustomerReceived(s.shop, customer.id)).toEqual([
      expect.objectContaining({ id: productId }),
    ]);
    expect(await productsCustomerReceived(s.shop, waiting.customer.id)).toEqual([]);
    await expect(share(customer, { permission: false })).rejects.toThrow(/permission/);
    await expect(share(waiting.customer, { productId: waiting.productId })).rejects.toThrow(
      /products you have received/,
    );
    await expect(
      share(customer, { bytes: new TextEncoder().encode("not a photo or video") }),
    ).rejects.toThrow(UgcError);

    const { id } = await share(customer, { caption: "Beach day" });
    const mine = await listMyUgc(s.shop, customer.id);
    expect(mine).toEqual([
      expect.objectContaining({ id, status: "pending", kind: "image", creditName: "Maya K." }),
    ]);
    // The exact wording and its version are kept, with a consent record.
    const row = await admin.ugcItem.findUniqueOrThrow({ where: { id } });
    expect(row.permissionText).toContain("Cedar Bags");
    expect(row.permissionVersion).toBe(UGC_PERMISSION_VERSION);
    const consent = await admin.consentRecord.findMany({
      where: { tenantId: s.tenantId, subjectId: customer.id, purpose: "ugc_reuse" },
    });
    expect(consent.map((c) => c.granted)).toEqual([true]);
    // Not shown until approved.
    expect(await listApprovedUgc(s.shop)).toEqual([]);
  });

  it("accepts short videos with their picture size", async () => {
    const s = await store("video");
    const { customer, productId } = await buyer(s.tenantId);
    const { id } = await shareUgc(s.shop, { storage }, customer, {
      productId,
      bytes: makeTestVideo({ width: 720, height: 1280 }),
      permission: true,
      storeName: "Shop",
      creditName: "@maya.style",
    });
    const [item] = await listMyUgc(s.shop, customer.id);
    expect(item).toMatchObject({ id, kind: "video", creditName: "@maya.style" });
    expect(item!.media).toMatchObject({ width: 720, height: 1280, mimeType: "video/mp4" });
  });
});

describe("withdrawing permission", () => {
  it("takes it down at once, deletes the file and keeps the record", async () => {
    const s = await store("withdraw");
    const { customer, productId } = await buyer(s.tenantId);
    const files = createMemoryStorage();
    const { id } = await shareUgc(s.shop, { storage: files }, customer, {
      productId,
      bytes: photo,
      permission: true,
      storeName: "Shop",
    });
    await moderateUgc(s.owner.db, s.owner.context, id, "approved");
    expect(await countApprovedUgc(s.shop)).toBe(1);
    expect(files.files.size).toBe(1);

    // Another customer cannot withdraw it.
    const other = await buyer(s.tenantId);
    await expect(withdrawUgc(s.shop, { storage: files }, other.customer.id, id)).rejects.toThrow(
      NotFoundError,
    );

    await withdrawUgc(s.shop, { storage: files }, customer.id, id);
    expect(files.files.size).toBe(0);
    expect(await listApprovedUgc(s.shop, { productId })).toEqual([]);
    const row = await admin.ugcItem.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "withdrawn", mediaAssetId: null });
    expect(row.permissionWithdrawnAt).toBeInstanceOf(Date);
    const consent = await admin.consentRecord.findMany({
      where: { tenantId: s.tenantId, subjectId: customer.id, purpose: "ugc_reuse" },
      orderBy: { recordedAt: "asc" },
    });
    expect(consent.map((c) => c.granted)).toEqual([true, false]);
    // It cannot be shown again, and the database refuses to show it without a file.
    await expect(moderateUgc(s.owner.db, s.owner.context, id, "approved")).rejects.toThrow(
      /taken down/,
    );
    await expect(
      admin.ugcItem.update({ where: { id }, data: { status: "approved" } }),
    ).rejects.toThrow();
  });
});

describe("staff", () => {
  it("approve, feature, hide and remove; the gallery shows only approved items", async () => {
    const s = await store("moderate");
    const files = createMemoryStorage();
    const a = await buyer(s.tenantId);
    const b = await buyer(s.tenantId);
    const first = await shareUgc(s.shop, { storage: files }, a.customer, {
      productId: a.productId,
      bytes: photo,
      permission: true,
      storeName: "Shop",
    });
    const second = await shareUgc(s.shop, { storage: files }, b.customer, {
      productId: b.productId,
      bytes: photo,
      permission: true,
      storeName: "Shop",
    });
    expect((await listUgcForModeration(s.owner.db, s.owner.context)).pending).toBe(2);
    await expect(moderateUgc(s.owner.db, s.owner.context, first.id, "feature")).rejects.toThrow(
      /Approve it before/,
    );
    await moderateUgc(s.owner.db, s.owner.context, first.id, "approved");
    await moderateUgc(s.owner.db, s.owner.context, second.id, "approved");
    await moderateUgc(s.owner.db, s.owner.context, second.id, "feature");
    expect((await listApprovedUgc(s.shop)).map((item) => item.id)).toEqual([second.id, first.id]);
    expect((await listApprovedUgc(s.shop, { productId: a.productId })).map((i) => i.id)).toEqual([
      first.id,
    ]);

    await moderateUgc(s.owner.db, s.owner.context, first.id, "hidden");
    expect((await listApprovedUgc(s.shop)).map((item) => item.id)).toEqual([second.id]);
    await removeUgc(s.owner.db, s.owner.context, { storage: files }, second.id);
    expect(await countApprovedUgc(s.shop)).toBe(0);
    expect(files.files.size).toBe(1); // only the hidden one's file remains
    // Records are never deleted by the application.
    await expect(
      withTenant(app, { tenantId: s.tenantId }, (tx) =>
        tx.ugcItem.deleteMany({ where: { id: second.id } }),
      ),
    ).rejects.toThrow();
  });

  it("add a creator's content only with a record of permission", async () => {
    const s = await store("creator");
    const files = createMemoryStorage();
    const base = {
      bytes: photo,
      creditName: "@lea.wears",
      sourceUrl: "https://www.instagram.com/p/abc123/",
      permissionNote: "By Instagram message on 12 November; screenshot saved.",
      confirmed: true,
    };
    await expect(
      addStaffUgc(s.owner.db, s.owner.context, { storage: files }, { ...base, confirmed: false }),
    ).rejects.toThrow(/creator's permission/);
    await expect(
      addStaffUgc(s.owner.db, s.owner.context, { storage: files }, { ...base, sourceUrl: "" }),
    ).rejects.toThrow(/where it was first posted/);
    await expect(
      addStaffUgc(
        s.owner.db,
        s.owner.context,
        { storage: files },
        { ...base, permissionNote: "ok" },
      ),
    ).rejects.toThrow(/how the creator gave permission/);
    expect(files.files.size).toBe(0);

    // The owner can moderate, so it is shown straight away.
    const { id } = await addStaffUgc(s.owner.db, s.owner.context, { storage: files }, base);
    expect((await listApprovedUgc(s.shop)).map((item) => item.id)).toEqual([id]);
    const [row] = (await listUgcForModeration(s.owner.db, s.owner.context, { status: "approved" }))
      .items;
    expect(row).toMatchObject({
      source: "staff",
      sourceUrl: "https://www.instagram.com/p/abc123/",
      permissionText: base.permissionNote,
    });

    // Staff who may add content but not moderate send it for approval.
    const editor = await staff(s.tenantId, "content_editor");
    if (
      editor.context.permissions.has("content.write") &&
      !editor.context.permissions.has("reviews.moderate")
    ) {
      const added = await addStaffUgc(editor.db, editor.context, { storage: files }, base);
      expect((await admin.ugcItem.findUniqueOrThrow({ where: { id: added.id } })).status).toBe(
        "pending",
      );
    }
    const stock = await staff(s.tenantId, "inventory_manager");
    await expect(listUgcForModeration(stock.db, stock.context)).rejects.toThrow(ForbiddenError);
  });

  it("see only their own store's items", async () => {
    const s = await store("sep-a");
    const other = await store("sep-b");
    const { customer, productId } = await buyer(s.tenantId);
    const { id } = await shareUgc(s.shop, { storage }, customer, {
      productId,
      bytes: photo,
      permission: true,
      storeName: "Shop",
    });
    expect((await listUgcForModeration(other.owner.db, other.owner.context)).items).toEqual([]);
    await expect(moderateUgc(other.owner.db, other.owner.context, id, "approved")).rejects.toThrow(
      NotFoundError,
    );
    // A customer of another store cannot share about this store's product.
    const outsider = await buyer(other.tenantId);
    await expect(
      shareUgc(other.shop, { storage }, outsider.customer, {
        productId,
        bytes: photo,
        permission: true,
        storeName: "Shop",
      }),
    ).rejects.toThrow(UgcError);
  });
});
