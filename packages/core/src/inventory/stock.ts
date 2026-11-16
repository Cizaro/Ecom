import type { AppTransaction } from "@ecom/db";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";

// Stock. Rules this file keeps:
//
// - A level changes only together with a movement row saying why, in the same
//   transaction. The database lets the application add movements but never
//   change or delete them, so the history always explains the numbers.
// - The database refuses impossible numbers (nothing negative; reserved plus
//   damaged never more than on hand), whatever code runs.
// - Taking stock (a reservation) is one conditional UPDATE that only succeeds
//   while enough is available. Two checkouts racing for the last item cannot
//   both win: the second waits for the first, then finds nothing left.
// - A variant with tracking switched off is sold without any stock check.

export const DEFAULT_LOW_STOCK = 3;
export const MAX_STOCK_QUANTITY = 1_000_000;
export const DEFAULT_HOLD_MINUTES = 15;

export type InventoryErrorCode = "invalid" | "insufficient" | "below_committed" | "not_tracked";

/** A stock request refused for a reason staff (or checkout) can act on. Safe to show. */
export class InventoryError extends Error {
  constructor(
    readonly code: InventoryErrorCode,
    message: string,
    /** For "insufficient": the variant and how many could be had. */
    readonly detail?: { variantId: string; available: number },
  ) {
    super(message);
    this.name = "InventoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: unknown, entity: string): asserts value is string {
  if (typeof value !== "string" || !UUID.test(value)) throw new NotFoundError(entity);
}

function assertQuantity(value: unknown, label: string, min = 1): asserts value is number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value > MAX_STOCK_QUANTITY
  ) {
    throw new InventoryError("invalid", `Enter ${label} as a whole number from ${min}.`);
  }
}

function cleanNote(value: unknown): string | null {
  const note = typeof value === "string" ? value.trim() : "";
  if (note.length > 500) {
    throw new InventoryError("invalid", "The note is too long (500 characters at most).");
  }
  return note === "" ? null : note;
}

// --- Availability ------------------------------------------------------------

export type StockStatus = "untracked" | "in_stock" | "low" | "out_of_stock";

export interface Availability {
  tracked: boolean;
  /** Sellable now across all locations; null when the variant is not tracked. */
  available: number | null;
  status: StockStatus;
}

export function stockStatus(
  tracked: boolean,
  available: number,
  lowThreshold: number | null,
): StockStatus {
  if (!tracked) return "untracked";
  if (available <= 0) return "out_of_stock";
  if (available <= (lowThreshold ?? DEFAULT_LOW_STOCK)) return "low";
  return "in_stock";
}

/** Availability of each variant, in one query. Unknown IDs are left out. */
export async function availabilityIn(
  tx: AppTransaction,
  variantIds: readonly string[],
): Promise<Map<string, Availability>> {
  const ids = [...new Set(variantIds)].filter((id) => UUID.test(id));
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<
    {
      id: string;
      track_inventory: boolean;
      low_stock_threshold: number | null;
      available: bigint | null;
    }[]
  >`
    SELECT v.id, v.track_inventory, v.low_stock_threshold,
           (SELECT sum(l.on_hand - l.reserved - l.damaged)
              FROM inventory_levels l WHERE l.variant_id = v.id) AS available
    FROM product_variants v
    WHERE v.id = ANY(${ids}::uuid[])`;
  return new Map(
    rows.map((row) => {
      const available = Number(row.available ?? 0);
      return [
        row.id,
        {
          tracked: row.track_inventory,
          available: row.track_inventory ? available : null,
          status: stockStatus(row.track_inventory, available, row.low_stock_threshold),
        },
      ];
    }),
  );
}

export async function getAvailability(
  db: TenantDb,
  variantIds: readonly string[],
): Promise<Map<string, Availability>> {
  return db.run((tx) => availabilityIn(tx, variantIds));
}

// --- Locations ---------------------------------------------------------------

export interface LocationSummary {
  id: string;
  name: string;
  address: string | null;
  isDefault: boolean;
}

const LOCATION_SELECT = { id: true, name: true, address: true, isDefault: true } as const;

/** The default location, created on first use so a store can receive stock straight away. */
async function defaultLocation(tx: AppTransaction, tenantId: string): Promise<LocationSummary> {
  const existing = await tx.inventoryLocation.findFirst({
    where: { isDefault: true },
    select: LOCATION_SELECT,
  });
  if (existing) return existing;
  // Two requests can arrive here at once for a new store. The insert skips
  // quietly if the other one got there first (unique name, one default),
  // and both then read the same row.
  await tx.$executeRaw`
    INSERT INTO inventory_locations (id, tenant_id, name, is_default, updated_at)
    SELECT gen_random_uuid(), ${tenantId}::uuid, 'Main location', true, now()
    WHERE NOT EXISTS (SELECT 1 FROM inventory_locations)
    ON CONFLICT DO NOTHING`;
  const created = await tx.inventoryLocation.findFirst({
    where: { isDefault: true },
    select: LOCATION_SELECT,
  });
  if (created) return created;
  // Locations exist but none is the default (not reachable through the app):
  // the oldest becomes it.
  const oldest = await tx.inventoryLocation.findFirstOrThrow({
    orderBy: { createdAt: "asc" },
    select: LOCATION_SELECT,
  });
  return tx.inventoryLocation.update({
    where: { id: oldest.id },
    data: { isDefault: true },
    select: LOCATION_SELECT,
  });
}

export async function listLocations(
  db: TenantDb,
  context: RequestContext,
): Promise<LocationSummary[]> {
  assertPermission(context, "inventory.read");
  return db.run(async (tx) => {
    await defaultLocation(tx, db.tenantId);
    return tx.inventoryLocation.findMany({
      select: LOCATION_SELECT,
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
  });
}

function cleanLocation(input: { name: unknown; address?: unknown }) {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "") throw new InventoryError("invalid", "Enter a name for the location.");
  if (name.length > 100) {
    throw new InventoryError("invalid", "The name is too long (100 characters at most).");
  }
  const address = typeof input.address === "string" ? input.address.trim() : "";
  if (address.length > 300) {
    throw new InventoryError("invalid", "The address is too long (300 characters at most).");
  }
  return { name, address: address === "" ? null : address };
}

const isUniqueViolation = (error: unknown) =>
  (error as { code?: unknown } | null)?.code === "P2002";

export async function createLocation(
  db: TenantDb,
  context: RequestContext,
  input: { name: unknown; address?: unknown },
): Promise<{ id: string }> {
  assertPermission(context, "inventory.adjust");
  const data = cleanLocation(input);
  try {
    return await db.run(async (tx) => {
      const isFirst = (await tx.inventoryLocation.count()) === 0;
      const created = await tx.inventoryLocation.create({
        data: { ...data, tenantId: db.tenantId, isDefault: isFirst },
        select: { id: true },
      });
      await audit(tx, context, "inventory.location_created", {
        type: "inventory_location",
        id: created.id,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new InventoryError("invalid", "Another location already has this name.");
    }
    throw error;
  }
}

export async function updateLocation(
  db: TenantDb,
  context: RequestContext,
  locationId: string,
  input: { name: unknown; address?: unknown },
): Promise<void> {
  assertPermission(context, "inventory.adjust");
  assertUuid(locationId, "location");
  const data = cleanLocation(input);
  try {
    await db.run(async (tx) => {
      const found = await tx.inventoryLocation.findUnique({ where: { id: locationId } });
      if (!found) throw new NotFoundError("location");
      await tx.inventoryLocation.update({ where: { id: locationId }, data });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new InventoryError("invalid", "Another location already has this name.");
    }
    throw error;
  }
}

export async function setDefaultLocation(
  db: TenantDb,
  context: RequestContext,
  locationId: string,
): Promise<void> {
  assertPermission(context, "inventory.adjust");
  assertUuid(locationId, "location");
  await db.run(async (tx) => {
    const found = await tx.inventoryLocation.findUnique({ where: { id: locationId } });
    if (!found) throw new NotFoundError("location");
    await tx.inventoryLocation.updateMany({
      where: { isDefault: true },
      data: { isDefault: false },
    });
    await tx.inventoryLocation.update({ where: { id: locationId }, data: { isDefault: true } });
    await audit(tx, context, "inventory.default_location_set", {
      type: "inventory_location",
      id: locationId,
    });
  });
}

// --- Staff: looking at stock -------------------------------------------------

export interface StockRow {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  color: string | null;
  size: string | null;
  onHand: number;
  reserved: number;
  damaged: number;
  available: number;
  lowThreshold: number;
  status: StockStatus;
}

export const STOCK_PAGE_SIZE = 50;

/** Every tracked variant with its totals across locations. */
export async function listStock(
  db: TenantDb,
  context: RequestContext,
  input: { search?: string; lowOnly?: boolean; page?: number } = {},
): Promise<{ items: StockRow[]; total: number; page: number; pageCount: number }> {
  assertPermission(context, "inventory.read");
  const search = (input.search ?? "").trim().slice(0, 100);
  const page = Number.isInteger(input.page) ? Math.min(10_000, Math.max(1, input.page!)) : 1;
  const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  return db.run(async (tx) => {
    const rows = await tx.$queryRaw<
      {
        variant_id: string;
        product_id: string;
        product_name: string;
        sku: string;
        color: string | null;
        size: string | null;
        low_stock_threshold: number | null;
        on_hand: bigint;
        reserved: bigint;
        damaged: bigint;
        total: bigint;
      }[]
    >`
      WITH totals AS (
        SELECT v.id AS variant_id, p.id AS product_id, p.name AS product_name, v.sku,
               v.color, v.size, v.low_stock_threshold, v.created_at,
               coalesce(sum(l.on_hand), 0) AS on_hand,
               coalesce(sum(l.reserved), 0) AS reserved,
               coalesce(sum(l.damaged), 0) AS damaged
        FROM product_variants v
        JOIN products p ON p.id = v.product_id
        LEFT JOIN inventory_levels l ON l.variant_id = v.id
        WHERE v.track_inventory AND v.status = 'active' AND p.status <> 'archived'
          AND (${search} = '' OR p.name ILIKE ${pattern} OR v.sku ILIKE ${pattern})
        GROUP BY v.id, p.id
      )
      SELECT *, count(*) OVER () AS total FROM totals
      WHERE NOT ${input.lowOnly === true}
         OR on_hand - reserved - damaged <= coalesce(low_stock_threshold, ${DEFAULT_LOW_STOCK})
      ORDER BY (on_hand - reserved - damaged) ASC, product_name, sku
      LIMIT ${STOCK_PAGE_SIZE} OFFSET ${(page - 1) * STOCK_PAGE_SIZE}`;
    const total = Number(rows[0]?.total ?? 0);
    return {
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / STOCK_PAGE_SIZE)),
      items: rows.map((row) => {
        const onHand = Number(row.on_hand);
        const reserved = Number(row.reserved);
        const damaged = Number(row.damaged);
        const available = onHand - reserved - damaged;
        return {
          variantId: row.variant_id,
          productId: row.product_id,
          productName: row.product_name,
          sku: row.sku,
          color: row.color,
          size: row.size,
          onHand,
          reserved,
          damaged,
          available,
          lowThreshold: row.low_stock_threshold ?? DEFAULT_LOW_STOCK,
          status: stockStatus(true, available, row.low_stock_threshold),
        };
      }),
    };
  });
}

export interface VariantStock {
  variantId: string;
  productId: string;
  productName: string;
  sku: string;
  color: string | null;
  size: string | null;
  tracked: boolean;
  lowThreshold: number;
  levels: (LocationSummary & {
    locationId: string;
    onHand: number;
    reserved: number;
    damaged: number;
    available: number;
  })[];
  totals: { onHand: number; reserved: number; damaged: number; available: number };
  status: StockStatus;
  movements: {
    id: string;
    locationName: string;
    bucket: "on_hand" | "reserved" | "damaged";
    reason: string;
    quantityDelta: number;
    note: string | null;
    actorName: string | null;
    createdAt: Date;
  }[];
}

/** One variant's stock at every location, and its most recent movements. */
export async function getVariantStock(
  db: TenantDb,
  context: RequestContext,
  variantId: string,
): Promise<VariantStock> {
  assertPermission(context, "inventory.read");
  assertUuid(variantId, "variant");
  return db.run(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        sku: true,
        color: true,
        size: true,
        trackInventory: true,
        lowStockThreshold: true,
        product: { select: { id: true, name: true } },
        inventoryLevels: {
          select: { locationId: true, onHand: true, reserved: true, damaged: true },
        },
        stockMovements: {
          select: {
            id: true,
            bucket: true,
            reason: true,
            quantityDelta: true,
            note: true,
            createdAt: true,
            location: { select: { name: true } },
            actor: { select: { name: true, email: true } },
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 50,
        },
      },
    });
    if (!variant) throw new NotFoundError("variant");
    await defaultLocation(tx, db.tenantId);
    const locations = await tx.inventoryLocation.findMany({
      select: LOCATION_SELECT,
      orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    });
    const byLocation = new Map(variant.inventoryLevels.map((level) => [level.locationId, level]));
    const levels = locations.map((location) => {
      const level = byLocation.get(location.id) ?? { onHand: 0, reserved: 0, damaged: 0 };
      return {
        ...location,
        locationId: location.id,
        onHand: level.onHand,
        reserved: level.reserved,
        damaged: level.damaged,
        available: level.onHand - level.reserved - level.damaged,
      };
    });
    const totals = levels.reduce(
      (sum, level) => ({
        onHand: sum.onHand + level.onHand,
        reserved: sum.reserved + level.reserved,
        damaged: sum.damaged + level.damaged,
        available: sum.available + level.available,
      }),
      { onHand: 0, reserved: 0, damaged: 0, available: 0 },
    );
    return {
      variantId: variant.id,
      productId: variant.product.id,
      productName: variant.product.name,
      sku: variant.sku,
      color: variant.color,
      size: variant.size,
      tracked: variant.trackInventory,
      lowThreshold: variant.lowStockThreshold ?? DEFAULT_LOW_STOCK,
      levels,
      totals,
      status: stockStatus(variant.trackInventory, totals.available, variant.lowStockThreshold),
      movements: variant.stockMovements.map((movement) => ({
        id: movement.id,
        locationName: movement.location.name,
        bucket: movement.bucket,
        reason: movement.reason,
        quantityDelta: movement.quantityDelta,
        note: movement.note,
        actorName: movement.actor ? movement.actor.name || movement.actor.email : null,
        createdAt: movement.createdAt,
      })),
    };
  });
}

// --- Staff: changing stock ---------------------------------------------------

interface LockedLevel {
  id: string;
  on_hand: number;
  reserved: number;
  damaged: number;
}

/**
 * The level row for a variant at a location, created if missing and locked
 * until the end of the transaction, so concurrent changes queue up.
 */
async function lockLevel(
  tx: AppTransaction,
  tenantId: string,
  variantId: string,
  locationId: string,
): Promise<LockedLevel> {
  await tx.$executeRaw`
    INSERT INTO inventory_levels (id, tenant_id, variant_id, location_id, updated_at)
    VALUES (gen_random_uuid(), ${tenantId}::uuid, ${variantId}::uuid, ${locationId}::uuid, now())
    ON CONFLICT (variant_id, location_id) DO NOTHING`;
  const [level] = await tx.$queryRaw<LockedLevel[]>`
    SELECT id, on_hand, reserved, damaged FROM inventory_levels
    WHERE variant_id = ${variantId}::uuid AND location_id = ${locationId}::uuid
    FOR UPDATE`;
  if (!level) throw new NotFoundError("stock level");
  return level;
}

interface Change {
  bucket: "on_hand" | "reserved" | "damaged";
  delta: number;
}

const COLUMN = { on_hand: "onHand", reserved: "reserved", damaged: "damaged" } as const;

/** Applies changes to a locked level and records one movement per change. */
async function applyChanges(
  tx: AppTransaction,
  tenantId: string,
  level: LockedLevel & { variantId: string; locationId: string },
  changes: Change[],
  movement: {
    reason: "purchase" | "sale" | "return" | "adjustment" | "damage" | "reservation" | "release";
    referenceType?: string;
    referenceId?: string;
    actorUserId?: string | null;
    note?: string | null;
  },
) {
  const nonZero = changes.filter((change) => change.delta !== 0);
  if (nonZero.length === 0) return;
  const data: Record<string, { increment: number }> = {};
  for (const change of nonZero) data[COLUMN[change.bucket]] = { increment: change.delta };
  await tx.inventoryLevel.update({ where: { id: level.id }, data });
  await tx.stockMovement.createMany({
    data: nonZero.map((change) => ({
      tenantId,
      variantId: level.variantId,
      locationId: level.locationId,
      quantityDelta: change.delta,
      bucket: change.bucket,
      reason: movement.reason,
      referenceType: movement.referenceType ?? null,
      referenceId: movement.referenceId ?? null,
      actorUserId: movement.actorUserId ?? null,
      note: movement.note ?? null,
    })),
  });
}

export type StockOperation = "receive" | "count" | "damage" | "remove_damaged";
export const STOCK_OPERATIONS: readonly StockOperation[] = [
  "receive",
  "count",
  "damage",
  "remove_damaged",
];

export interface StockChangeInput {
  variantId: string;
  locationId: string;
  operation: StockOperation;
  /** For "count", the number now physically there; otherwise how many. */
  quantity: number;
  note?: unknown;
}

/**
 * A change made by staff:
 * - receive: new stock arrived (on hand goes up);
 * - count: the shelf was counted and this many are there (on hand set to it);
 * - damage: items found damaged (moved out of what can be sold);
 * - remove_damaged: damaged items thrown away or sent back (they leave on hand).
 */
export async function changeStock(
  db: TenantDb,
  context: RequestContext,
  input: StockChangeInput,
): Promise<void> {
  assertPermission(context, "inventory.adjust");
  assertUuid(input.variantId, "variant");
  assertUuid(input.locationId, "location");
  if (!STOCK_OPERATIONS.includes(input.operation)) {
    throw new InventoryError("invalid", "Choose what kind of change this is.");
  }
  assertQuantity(
    input.quantity,
    input.operation === "count" ? "the counted number" : "the quantity",
    input.operation === "count" ? 0 : 1,
  );
  const note = cleanNote(input.note);
  if (input.operation === "count" && !note) {
    throw new InventoryError("invalid", 'Say why the count changed, for example "Stock take".');
  }

  await db.run(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: input.variantId },
      select: { trackInventory: true },
    });
    if (!variant) throw new NotFoundError("variant");
    if (!variant.trackInventory) {
      throw new InventoryError(
        "not_tracked",
        "Stock is not counted for this variant. Switch on stock tracking first.",
      );
    }
    const location = await tx.inventoryLocation.findUnique({ where: { id: input.locationId } });
    if (!location) throw new NotFoundError("location");

    const level = await lockLevel(tx, db.tenantId, input.variantId, input.locationId);
    const available = level.on_hand - level.reserved - level.damaged;
    const q = input.quantity;
    let changes: Change[];
    let reason: "purchase" | "adjustment" | "damage";
    switch (input.operation) {
      case "receive":
        changes = [{ bucket: "on_hand", delta: q }];
        reason = "purchase";
        break;
      case "count":
        if (q < level.reserved + level.damaged) {
          throw new InventoryError(
            "below_committed",
            `There must be at least ${level.reserved + level.damaged} here: ` +
              `${level.reserved} promised to orders and ${level.damaged} marked damaged.`,
          );
        }
        changes = [{ bucket: "on_hand", delta: q - level.on_hand }];
        reason = "adjustment";
        break;
      case "damage":
        if (q > available) {
          throw new InventoryError("insufficient", `Only ${available} can be marked damaged here.`);
        }
        changes = [{ bucket: "damaged", delta: q }];
        reason = "damage";
        break;
      case "remove_damaged":
        if (q > level.damaged) {
          throw new InventoryError(
            "insufficient",
            `Only ${level.damaged} are marked damaged here.`,
          );
        }
        changes = [
          { bucket: "damaged", delta: -q },
          { bucket: "on_hand", delta: -q },
        ];
        reason = "damage";
        break;
    }
    await applyChanges(
      tx,
      db.tenantId,
      { ...level, variantId: input.variantId, locationId: input.locationId },
      changes,
      { reason, actorUserId: context.userId, note },
    );
    await audit(
      tx,
      context,
      `inventory.${input.operation}`,
      { type: "variant", id: input.variantId },
      { onHand: level.on_hand, reserved: level.reserved, damaged: level.damaged },
      { locationId: input.locationId, quantity: q, note },
    );
  });
}

/** Switches stock counting on or off for a variant. */
export async function setTracking(
  db: TenantDb,
  context: RequestContext,
  variantId: string,
  tracked: boolean,
): Promise<void> {
  assertPermission(context, "inventory.adjust");
  assertUuid(variantId, "variant");
  await db.run(async (tx) => {
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { trackInventory: true },
    });
    if (!variant) throw new NotFoundError("variant");
    if (variant.trackInventory === tracked) return;
    if (!tracked) {
      const held = await tx.stockReservation.count({ where: { variantId, status: "active" } });
      if (held > 0) {
        throw new InventoryError(
          "invalid",
          "Items of this variant are held for checkouts in progress. Try again in a few minutes.",
        );
      }
    }
    await tx.productVariant.update({ where: { id: variantId }, data: { trackInventory: tracked } });
    await audit(
      tx,
      context,
      "inventory.tracking_changed",
      { type: "variant", id: variantId },
      { tracked: variant.trackInventory },
      { tracked },
    );
  });
}

// --- Checkout: holding, selling and giving back -------------------------------

export interface ReservationRequest {
  /** What the hold is for, for example "checkout". */
  referenceType: string;
  referenceId: string;
  items: readonly { variantId: string; quantity: number }[];
  holdMinutes?: number;
}

/**
 * Holds stock for every tracked item, or for none: if any item cannot be
 * had in full, nothing is held and the error names the first one short.
 * Items not tracked are skipped. Each item is taken from a single location,
 * the default first.
 */
export async function reserveStock(
  db: TenantDb,
  request: ReservationRequest,
): Promise<{ reservationIds: string[] }> {
  return db.run((tx) => reserveStockIn(tx, db.tenantId, request));
}

/**
 * The same, inside a transaction the caller already has open, so the hold
 * and whatever it is for (an order) are made or undone together.
 */
export async function reserveStockIn(
  tx: AppTransaction,
  tenantId: string,
  request: ReservationRequest,
): Promise<{ reservationIds: string[] }> {
  assertUuid(request.referenceId, "reference");
  const minutes = request.holdMinutes ?? DEFAULT_HOLD_MINUTES;
  const merged = new Map<string, number>();
  for (const item of request.items) {
    assertUuid(item.variantId, "variant");
    assertQuantity(item.quantity, "the quantity");
    merged.set(item.variantId, (merged.get(item.variantId) ?? 0) + item.quantity);
  }

  {
    const tracking = await tx.productVariant.findMany({
      where: { id: { in: [...merged.keys()] } },
      select: { id: true, trackInventory: true },
    });
    const tracked = new Map(tracking.map((row) => [row.id, row.trackInventory]));
    const ids: string[] = [];
    const expiresAt = new Date(Date.now() + minutes * 60_000);

    for (const [variantId, quantity] of merged) {
      if (!tracked.has(variantId)) throw new NotFoundError("variant");
      if (!tracked.get(variantId)) continue;
      const candidates = await tx.$queryRaw<
        { id: string; location_id: string; available: number }[]
      >`
        SELECT l.id, l.location_id, l.on_hand - l.reserved - l.damaged AS available
        FROM inventory_levels l JOIN inventory_locations loc ON loc.id = l.location_id
        WHERE l.variant_id = ${variantId}::uuid
        ORDER BY loc.is_default DESC, available DESC`;
      let takenFrom: string | null = null;
      for (const candidate of candidates) {
        // Succeeds only while enough is available, checked again under the row lock.
        const updated = await tx.$executeRaw`
          UPDATE inventory_levels SET reserved = reserved + ${quantity}, updated_at = now()
          WHERE id = ${candidate.id}::uuid AND on_hand - reserved - damaged >= ${quantity}`;
        if (updated === 1) {
          takenFrom = candidate.location_id;
          break;
        }
      }
      if (!takenFrom) {
        const best = candidates.reduce((max, c) => Math.max(max, Number(c.available)), 0);
        // Throwing rolls back every hold made earlier in this request.
        throw new InventoryError(
          "insufficient",
          best > 0 ? `Only ${best} of this item can be had.` : "This item is out of stock.",
          { variantId, available: Math.max(0, best) },
        );
      }
      const reservation = await tx.stockReservation.create({
        data: {
          tenantId: tenantId,
          variantId,
          locationId: takenFrom,
          quantity,
          referenceType: request.referenceType,
          referenceId: request.referenceId,
          expiresAt,
        },
        select: { id: true },
      });
      await tx.stockMovement.create({
        data: {
          tenantId: tenantId,
          variantId,
          locationId: takenFrom,
          quantityDelta: quantity,
          bucket: "reserved",
          reason: "reservation",
          referenceType: "reservation",
          referenceId: reservation.id,
        },
      });
      ids.push(reservation.id);
    }
    return { reservationIds: ids };
  }
}

/** Releases or commits holds inside a transaction the caller already has open. */
export async function settleReservationsIn(
  tx: AppTransaction,
  tenantId: string,
  where: { referenceType?: string; referenceId?: string; expiredBefore?: Date },
  outcome: "release" | "commit",
): Promise<number> {
  const reservations = await tx.stockReservation.findMany({
    where: {
      status: "active",
      ...(where.referenceType ? { referenceType: where.referenceType } : {}),
      ...(where.referenceId ? { referenceId: where.referenceId } : {}),
      ...(where.expiredBefore ? { expiresAt: { lt: where.expiredBefore } } : {}),
    },
    select: { id: true, variantId: true, locationId: true, quantity: true },
  });
  for (const reservation of reservations) {
    // Only the first to settle a reservation acts on it.
    const claimed = await tx.stockReservation.updateMany({
      where: { id: reservation.id, status: "active" },
      data: { status: outcome === "commit" ? "committed" : "released" },
    });
    if (claimed.count !== 1) continue;
    const level = await lockLevel(tx, tenantId, reservation.variantId, reservation.locationId);
    const changes: Change[] =
      outcome === "commit"
        ? [
            { bucket: "reserved", delta: -reservation.quantity },
            { bucket: "on_hand", delta: -reservation.quantity },
          ]
        : [{ bucket: "reserved", delta: -reservation.quantity }];
    await applyChanges(
      tx,
      tenantId,
      { ...level, variantId: reservation.variantId, locationId: reservation.locationId },
      changes,
      {
        reason: outcome === "commit" ? "sale" : "release",
        referenceType: "reservation",
        referenceId: reservation.id,
      },
    );
  }
  return reservations.length;
}

/** Gives back everything held for this reference (an abandoned checkout, a failed payment). */
export async function releaseReservations(
  db: TenantDb,
  referenceType: string,
  referenceId: string,
): Promise<number> {
  assertUuid(referenceId, "reference");
  return db.run((tx) =>
    settleReservationsIn(tx, db.tenantId, { referenceType, referenceId }, "release"),
  );
}

/** Turns what is held for this reference into a sale: the items leave on hand. */
export async function commitReservations(
  db: TenantDb,
  referenceType: string,
  referenceId: string,
): Promise<number> {
  assertUuid(referenceId, "reference");
  return db.run((tx) =>
    settleReservationsIn(tx, db.tenantId, { referenceType, referenceId }, "commit"),
  );
}

/** Gives back every hold in this tenant whose time has run out. Run by the worker. */
export async function releaseExpiredReservations(db: TenantDb, now = new Date()): Promise<number> {
  return db.run((tx) => settleReservationsIn(tx, db.tenantId, { expiredBefore: now }, "release"));
}

/**
 * Puts back on the shelf what was sold for this reference: a parcel that came
 * back (for example, refused at the door). Each item returns to the location
 * it was taken from, recorded as a "return" movement. Acts once per hold.
 */
export async function returnCommittedIn(
  tx: AppTransaction,
  tenantId: string,
  referenceType: string,
  referenceId: string,
  actorUserId: string | null,
): Promise<number> {
  const sold = await tx.stockReservation.findMany({
    where: { referenceType, referenceId, status: "committed" },
    select: { id: true, variantId: true, locationId: true, quantity: true },
  });
  let returned = 0;
  for (const reservation of sold) {
    // Marked "released" so the same items can never be returned twice.
    const claimed = await tx.stockReservation.updateMany({
      where: { id: reservation.id, status: "committed" },
      data: { status: "released" },
    });
    if (claimed.count !== 1) continue;
    const level = await lockLevel(tx, tenantId, reservation.variantId, reservation.locationId);
    await applyChanges(
      tx,
      tenantId,
      { ...level, variantId: reservation.variantId, locationId: reservation.locationId },
      [{ bucket: "on_hand", delta: reservation.quantity }],
      {
        reason: "return",
        referenceType: "reservation",
        referenceId: reservation.id,
        actorUserId,
        note: "Parcel came back",
      },
    );
    returned += reservation.quantity;
  }
  return returned;
}

/**
 * Puts items a customer returned back on the shelf, at the location they were
 * sold from (or the default location). Resellable items can be sold again;
 * damaged ones are kept apart (counted on hand and damaged, so not for sale).
 * Does nothing for a product whose stock is not counted, or one since deleted.
 */
export async function restockReturnedIn(
  tx: AppTransaction,
  tenantId: string,
  input: {
    variantId: string | null;
    quantity: number;
    condition: "resellable" | "damaged";
    orderId: string;
    returnId: string;
    actorUserId: string | null;
  },
): Promise<boolean> {
  if (!input.variantId || input.quantity <= 0) return false;
  const variant = await tx.productVariant.findUnique({
    where: { id: input.variantId },
    select: { trackInventory: true },
  });
  if (!variant?.trackInventory) return false;
  const sold = await tx.stockReservation.findFirst({
    where: {
      referenceType: "order",
      referenceId: input.orderId,
      variantId: input.variantId,
      status: "committed",
    },
    select: { locationId: true },
    orderBy: { createdAt: "asc" },
  });
  const locationId = sold?.locationId ?? (await defaultLocation(tx, tenantId)).id;
  const level = await lockLevel(tx, tenantId, input.variantId, locationId);
  const changes: Change[] = [{ bucket: "on_hand", delta: input.quantity }];
  if (input.condition === "damaged") changes.push({ bucket: "damaged", delta: input.quantity });
  await applyChanges(tx, tenantId, { ...level, variantId: input.variantId, locationId }, changes, {
    reason: "return",
    referenceType: "return",
    referenceId: input.returnId,
    actorUserId: input.actorUserId,
    note: input.condition === "damaged" ? "Returned damaged" : "Returned by customer",
  });
  return true;
}
