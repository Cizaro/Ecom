import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ForbiddenError, NotFoundError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { listTenantsWithExpiredReservations } from "../platform/stock-sweep";
import {
  changeStock,
  commitReservations,
  createLocation,
  getAvailability,
  getVariantStock,
  InventoryError,
  listLocations,
  listStock,
  releaseExpiredReservations,
  releaseReservations,
  reserveStock,
  setDefaultLocation,
  setTracking,
  type InventoryErrorCode,
} from "./stock";

// Stock against the real (test) database on the runtime connection, so
// Row-Level Security and the database's own rules are in force.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const userIds: string[] = [];

interface Actor {
  context: RequestContext;
  db: TenantDb;
}

let tenantA: string;
let tenantB: string;
let shopA: TenantDb;
let owner: Actor;
let stockKeeper: Actor;
let support: Actor;
let other: Actor;

async function createTenant(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Stock ${label} ${run}`, slug: `stock-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

async function createActor(tenantId: string, role: SystemRoleKey): Promise<Actor> {
  const user = await admin.user.create({
    data: { email: `stock-${role}-${randomUUID().slice(0, 8)}@example.test`, name: role },
  });
  userIds.push(user.id);
  const roleRow = await admin.role.findFirstOrThrow({ where: { tenantId: null, key: role } });
  await admin.userTenantMembership.create({
    data: { userId: user.id, tenantId, roleId: roleRow.id },
  });
  const permissions = SYSTEM_ROLES.find((r) => r.key === role)!.permissions;
  const context: RequestContext = {
    requestId: `req-${run}`,
    ip: "203.0.113.50",
    userId: user.id,
    isPlatformAdmin: false,
    tenantId,
    tenantSlug: "x",
    tenantName: "x",
    storeId: null,
    roleKey: role,
    roleName: role,
    permissions: new Set<PermissionKey>(permissions as readonly PermissionKey[]),
  };
  return { context, db: createTenantDb(app, context) };
}

async function variant(tenantId: string, options: { tracked?: boolean; low?: number } = {}) {
  const tag = randomUUID().slice(0, 8);
  const product = await admin.product.create({
    data: { tenantId, name: `Item ${tag}`, slug: `item-${tag}`, status: "active" },
  });
  return admin.productVariant.create({
    data: {
      tenantId,
      productId: product.id,
      sku: `STK-${tag}`,
      priceAmount: 1000,
      currency: "USD",
      trackInventory: options.tracked ?? true,
      lowStockThreshold: options.low ?? null,
    },
  });
}

async function mainLocation(actor: Actor = owner) {
  return (await listLocations(actor.db, actor.context)).find((location) => location.isDefault)!;
}

async function receive(variantId: string, quantity: number, locationId?: string) {
  await changeStock(owner.db, owner.context, {
    variantId,
    locationId: locationId ?? (await mainLocation()).id,
    operation: "receive",
    quantity,
  });
}

const available = async (variantId: string) =>
  (await getAvailability(shopA, [variantId])).get(variantId)!;

async function expectError(work: Promise<unknown>, code: InventoryErrorCode) {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error, `expected InventoryError ${code}`).toBeInstanceOf(InventoryError);
  expect((error as InventoryError).code).toBe(code);
  return error as InventoryError;
}

beforeAll(async () => {
  tenantA = await createTenant("a");
  tenantB = await createTenant("b");
  shopA = createTenantDb(app, { tenantId: tenantA });
  owner = await createActor(tenantA, "store_owner");
  stockKeeper = await createActor(tenantA, "inventory_manager");
  support = await createActor(tenantA, "customer_service");
  other = await createActor(tenantB, "store_owner");
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("locations", () => {
  it("starts with a default location and keeps exactly one default", async () => {
    const first = await listLocations(owner.db, owner.context);
    expect(first).toEqual([expect.objectContaining({ name: "Main location", isDefault: true })]);
    const warehouse = await createLocation(owner.db, owner.context, {
      name: "Warehouse",
      address: "Unit 4",
    });
    let locations = await listLocations(owner.db, owner.context);
    expect(locations.filter((location) => location.isDefault)).toHaveLength(1);

    await setDefaultLocation(owner.db, owner.context, warehouse.id);
    locations = await listLocations(owner.db, owner.context);
    expect(locations[0]).toMatchObject({ id: warehouse.id, isDefault: true });
    expect(locations.filter((location) => location.isDefault)).toHaveLength(1);
    // Put the original back as default for the rest of the tests.
    await setDefaultLocation(owner.db, owner.context, first[0]!.id);

    await expectError(createLocation(owner.db, owner.context, { name: "Warehouse" }), "invalid");
    await expectError(createLocation(owner.db, owner.context, { name: "  " }), "invalid");
  });
});

describe("changing stock", () => {
  it("receives, counts, marks damaged and removes damaged, recording every change", async () => {
    const item = await variant(tenantA, { low: 2 });
    const location = await mainLocation();
    const change = (
      operation: "receive" | "count" | "damage" | "remove_damaged",
      quantity: number,
      note?: string,
    ) =>
      changeStock(stockKeeper.db, stockKeeper.context, {
        variantId: item.id,
        locationId: location.id,
        operation,
        quantity,
        note,
      });

    await change("receive", 10);
    expect(await available(item.id)).toEqual({ tracked: true, available: 10, status: "in_stock" });
    await change("damage", 2);
    expect((await available(item.id)).available).toBe(8);
    await change("remove_damaged", 1);
    await change("count", 3, "Stock take");

    const stock = await getVariantStock(owner.db, owner.context, item.id);
    expect(stock.totals).toEqual({ onHand: 3, reserved: 0, damaged: 1, available: 2 });
    expect(stock.status).toBe("low");
    // Newest first; each change has a reason and who made it. The two rows of
    // "remove damaged" are written together, so their order between them is not fixed.
    const rows = stock.movements.map((m) => [m.reason, m.bucket, m.quantityDelta]);
    expect(rows[0]).toEqual(["adjustment", "on_hand", -6]);
    expect(rows.slice(1, 3)).toEqual(
      expect.arrayContaining([
        ["damage", "damaged", -1],
        ["damage", "on_hand", -1],
      ]),
    );
    expect(rows.slice(3)).toEqual([
      ["damage", "damaged", 2],
      ["purchase", "on_hand", 10],
    ]);
    expect(stock.movements[0]).toMatchObject({
      note: "Stock take",
      actorName: "inventory_manager",
    });
    // The history adds up to the level.
    const onHand = stock.movements
      .filter((m) => m.bucket === "on_hand")
      .reduce((sum, m) => sum + m.quantityDelta, 0);
    expect(onHand).toBe(stock.totals.onHand);
  });

  it("refuses changes that would make the numbers impossible", async () => {
    const item = await variant(tenantA);
    const location = await mainLocation();
    const change = (
      operation: "count" | "damage" | "remove_damaged" | "receive",
      quantity: number,
      note?: string,
    ) =>
      changeStock(owner.db, owner.context, {
        variantId: item.id,
        locationId: location.id,
        operation,
        quantity,
        note,
      });
    await change("receive", 5);
    await reserveStock(shopA, {
      referenceType: "checkout",
      referenceId: randomUUID(),
      items: [{ variantId: item.id, quantity: 3 }],
    });
    await change("damage", 1);

    const below = await expectError(change("count", 3, "Recount"), "below_committed");
    expect(below.message).toContain("at least 4");
    await expectError(change("damage", 2), "insufficient");
    await expectError(change("remove_damaged", 2), "insufficient");
    await expectError(change("count", 6), "invalid"); // a count needs a reason
    for (const quantity of [0, -1, 1.5, 2_000_000, Number.NaN]) {
      await expectError(change("receive", quantity), "invalid");
    }
    expect((await getVariantStock(owner.db, owner.context, item.id)).totals).toEqual({
      onHand: 5,
      reserved: 3,
      damaged: 1,
      available: 1,
    });

    // The database refuses impossible numbers even if code tried.
    await expect(
      admin.inventoryLevel.updateMany({ where: { variantId: item.id }, data: { reserved: 9 } }),
    ).rejects.toThrow();
    await expect(
      admin.inventoryLevel.updateMany({ where: { variantId: item.id }, data: { onHand: -1 } }),
    ).rejects.toThrow();
  });

  it("keeps the history unchangeable for the application", async () => {
    const item = await variant(tenantA);
    await receive(item.id, 2);
    const asTenant = { tenantId: tenantA };
    await expect(
      withTenant(app, asTenant, (tx) =>
        tx.stockMovement.updateMany({ where: { variantId: item.id }, data: { quantityDelta: 99 } }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app, asTenant, (tx) =>
        tx.stockMovement.deleteMany({ where: { variantId: item.id } }),
      ),
    ).rejects.toThrow();
  });

  it("is open to staff with the permission only", async () => {
    const item = await variant(tenantA);
    const location = await mainLocation();
    // Customer service can look (inventory.read) but not change.
    await getVariantStock(support.db, support.context, item.id);
    await expect(
      changeStock(support.db, support.context, {
        variantId: item.id,
        locationId: location.id,
        operation: "receive",
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(setTracking(support.db, support.context, item.id, false)).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });

  it("keeps another store out entirely", async () => {
    const item = await variant(tenantA);
    await receive(item.id, 4);
    const location = await mainLocation();
    const attempts = [
      () => getVariantStock(other.db, other.context, item.id),
      () =>
        changeStock(other.db, other.context, {
          variantId: item.id,
          locationId: location.id,
          operation: "receive",
          quantity: 100,
        }),
      () => setTracking(other.db, other.context, item.id, false),
      () => setDefaultLocation(other.db, other.context, location.id),
    ];
    for (const attempt of attempts) await expect(attempt()).rejects.toBeInstanceOf(NotFoundError);
    // Store B's own location cannot hold store A's variant.
    const theirs = await mainLocation(other);
    await expect(
      changeStock(owner.db, owner.context, {
        variantId: item.id,
        locationId: theirs.id,
        operation: "receive",
        quantity: 1,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      (await listStock(other.db, other.context)).items.some((row) => row.variantId === item.id),
    ).toBe(false);
    expect((await available(item.id)).available).toBe(4);
    await expect(
      reserveStock(createTenantDb(app, { tenantId: tenantB }), {
        referenceType: "checkout",
        referenceId: randomUUID(),
        items: [{ variantId: item.id, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("holding stock for checkout", () => {
  it("never lets two checkouts take the same last item", async () => {
    const item = await variant(tenantA);
    await receive(item.id, 1);
    const attempt = () =>
      reserveStock(createTenantDb(app, { tenantId: tenantA }), {
        referenceType: "checkout",
        referenceId: randomUUID(),
        items: [{ variantId: item.id, quantity: 1 }],
      });
    const results = await Promise.allSettled(Array.from({ length: 8 }, attempt));
    const won = results.filter((result) => result.status === "fulfilled");
    const lost = results.filter((result) => result.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(7);
    for (const result of lost) {
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(InventoryError);
    }
    expect(await available(item.id)).toMatchObject({ available: 0, status: "out_of_stock" });
    const stock = await getVariantStock(owner.db, owner.context, item.id);
    expect(stock.totals).toMatchObject({ onHand: 1, reserved: 1 });
  });

  it("holds all items or none", async () => {
    const plenty = await variant(tenantA);
    const scarce = await variant(tenantA);
    await receive(plenty.id, 10);
    await receive(scarce.id, 1);
    const error = await expectError(
      reserveStock(shopA, {
        referenceType: "checkout",
        referenceId: randomUUID(),
        items: [
          { variantId: plenty.id, quantity: 3 },
          { variantId: scarce.id, quantity: 2 },
        ],
      }),
      "insufficient",
    );
    expect(error.detail).toEqual({ variantId: scarce.id, available: 1 });
    expect((await available(plenty.id)).available).toBe(10);
  });

  it("takes from the default location first, then from another with enough", async () => {
    const item = await variant(tenantA);
    const main = await mainLocation();
    const second = await createLocation(owner.db, owner.context, {
      name: `Shop ${randomUUID().slice(0, 6)}`,
    });
    await receive(item.id, 1, main.id);
    await receive(item.id, 5, second.id);
    const reference = randomUUID();
    await reserveStock(shopA, {
      referenceType: "checkout",
      referenceId: reference,
      items: [{ variantId: item.id, quantity: 3 }],
    });
    const stock = await getVariantStock(owner.db, owner.context, item.id);
    expect(stock.levels.find((level) => level.locationId === second.id)?.reserved).toBe(3);
    expect(stock.levels.find((level) => level.locationId === main.id)?.reserved).toBe(0);
  });

  it("sells what was held, or gives it back, exactly once", async () => {
    const item = await variant(tenantA);
    await receive(item.id, 5);
    const sold = randomUUID();
    const abandoned = randomUUID();
    await reserveStock(shopA, {
      referenceType: "checkout",
      referenceId: sold,
      items: [{ variantId: item.id, quantity: 2 }],
    });
    await reserveStock(shopA, {
      referenceType: "checkout",
      referenceId: abandoned,
      items: [{ variantId: item.id, quantity: 1 }],
    });
    expect((await available(item.id)).available).toBe(2);

    expect(await commitReservations(shopA, "checkout", sold)).toBe(1);
    expect(await commitReservations(shopA, "checkout", sold)).toBe(0);
    expect(await releaseReservations(shopA, "checkout", abandoned)).toBe(1);
    expect(await releaseReservations(shopA, "checkout", abandoned)).toBe(0);

    const stock = await getVariantStock(owner.db, owner.context, item.id);
    expect(stock.totals).toEqual({ onHand: 3, reserved: 0, damaged: 0, available: 3 });
    expect(stock.movements.map((m) => m.reason)).toEqual(
      expect.arrayContaining(["sale", "release", "reservation", "purchase"]),
    );
  });

  it("gives back holds whose time ran out", async () => {
    const item = await variant(tenantA);
    await receive(item.id, 2);
    await reserveStock(shopA, {
      referenceType: "checkout",
      referenceId: randomUUID(),
      items: [{ variantId: item.id, quantity: 2 }],
      holdMinutes: 1,
    });
    expect((await available(item.id)).available).toBe(0);
    const later = new Date(Date.now() + 5 * 60_000);
    expect(await listTenantsWithExpiredReservations(env.DATABASE_ADMIN_URL, later)).toContain(
      tenantA,
    );
    await releaseExpiredReservations(shopA, later);
    expect((await available(item.id)).available).toBe(2);
  });

  it("skips items whose stock is not counted", async () => {
    const untracked = await variant(tenantA, { tracked: false });
    const { reservationIds } = await reserveStock(shopA, {
      referenceType: "checkout",
      referenceId: randomUUID(),
      items: [{ variantId: untracked.id, quantity: 9 }],
    });
    expect(reservationIds).toEqual([]);
    expect(await available(untracked.id)).toEqual({
      tracked: false,
      available: null,
      status: "untracked",
    });
    await expectError(
      changeStock(owner.db, owner.context, {
        variantId: untracked.id,
        locationId: (await mainLocation()).id,
        operation: "receive",
        quantity: 1,
      }),
      "not_tracked",
    );
    // Switching tracking on starts the count at nothing.
    await setTracking(owner.db, owner.context, untracked.id, true);
    expect(await available(untracked.id)).toMatchObject({ available: 0, status: "out_of_stock" });
  });
});

describe("the stock list", () => {
  it("lists tracked variants with the lowest first and filters to low stock", async () => {
    const tag = randomUUID().slice(0, 6);
    const product = await admin.product.create({
      data: { tenantId: tenantA, name: `Listed ${tag}`, slug: `listed-${tag}`, status: "active" },
    });
    const make = (sku: string, low: number | null) =>
      admin.productVariant.create({
        data: {
          tenantId: tenantA,
          productId: product.id,
          sku: `${sku}-${tag}`,
          priceAmount: 100,
          currency: "USD",
          lowStockThreshold: low,
        },
      });
    const lots = await make("LOTS", 5);
    const few = await make("FEW", 5);
    await make("NONE", null);
    await receive(lots.id, 50);
    await receive(few.id, 4);

    const all = await listStock(owner.db, owner.context, { search: tag });
    expect(all.items.map((row) => [row.sku.split("-")[0], row.available, row.status])).toEqual([
      ["NONE", 0, "out_of_stock"],
      ["FEW", 4, "low"],
      ["LOTS", 50, "in_stock"],
    ]);
    const low = await listStock(owner.db, owner.context, { search: tag, lowOnly: true });
    expect(low.items.map((row) => row.sku.split("-")[0])).toEqual(["NONE", "FEW"]);
  });
});

describe("a store's first location", () => {
  it("is created once even when several requests need it at the same moment", async () => {
    const fresh = await createTenant(`fresh-${randomUUID().slice(0, 4)}`);
    const actor = await createActor(fresh, "store_owner");
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        listLocations(createTenantDb(app, actor.context), actor.context),
      ),
    );
    for (const locations of results) {
      expect(locations).toEqual([
        expect.objectContaining({ name: "Main location", isDefault: true }),
      ]);
    }
    expect(await admin.inventoryLocation.count({ where: { tenantId: fresh } })).toBe(1);
  });
});
