-- CreateEnum
CREATE TYPE "stock_bucket" AS ENUM ('on_hand', 'reserved', 'damaged');

-- CreateEnum
CREATE TYPE "stock_reason" AS ENUM ('purchase', 'sale', 'return', 'adjustment', 'damage', 'reservation', 'release');

-- CreateEnum
CREATE TYPE "reservation_status" AS ENUM ('active', 'committed', 'released');

-- AlterTable
ALTER TABLE "product_variants" ADD COLUMN     "track_inventory" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "inventory_locations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_levels" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "on_hand" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "damaged" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "inventory_levels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity_delta" INTEGER NOT NULL,
    "bucket" "stock_bucket" NOT NULL,
    "reason" "stock_reason" NOT NULL,
    "reference_type" TEXT,
    "reference_id" UUID,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_reservations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "location_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "reservation_status" NOT NULL DEFAULT 'active',
    "reference_type" TEXT NOT NULL,
    "reference_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inventory_locations_tenant_id_name_key" ON "inventory_locations"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "inventory_levels_tenant_id_idx" ON "inventory_levels"("tenant_id");

-- CreateIndex
CREATE INDEX "inventory_levels_location_id_idx" ON "inventory_levels"("location_id");

-- CreateIndex
CREATE UNIQUE INDEX "inventory_levels_variant_id_location_id_key" ON "inventory_levels"("variant_id", "location_id");

-- CreateIndex
CREATE INDEX "stock_movements_variant_id_created_at_idx" ON "stock_movements"("variant_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_tenant_id_created_at_idx" ON "stock_movements"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_reservations_reference_type_reference_id_idx" ON "stock_reservations"("reference_type", "reference_id");

-- CreateIndex
CREATE INDEX "stock_reservations_status_expires_at_idx" ON "stock_reservations"("status", "expires_at");

-- CreateIndex
CREATE INDEX "stock_reservations_tenant_id_idx" ON "stock_reservations"("tenant_id");

-- AddForeignKey
ALTER TABLE "inventory_locations" ADD CONSTRAINT "inventory_locations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_levels" ADD CONSTRAINT "inventory_levels_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_reservations" ADD CONSTRAINT "stock_reservations_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "inventory_locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written from here: rules Prisma cannot express.
-- ---------------------------------------------------------------------------

-- Variants that existed before stock tracking was built were being sold with
-- no stock count; keep them sellable. New variants are tracked by default.
UPDATE product_variants SET track_inventory = false;

ALTER TABLE inventory_locations
  ADD CONSTRAINT inventory_locations_name_present CHECK (btrim(name) <> ''),
  ADD CONSTRAINT inventory_locations_name_length CHECK (char_length(name) <= 100);
-- One default location per tenant.
CREATE UNIQUE INDEX inventory_locations_one_default
  ON inventory_locations (tenant_id) WHERE is_default;

-- The numbers can never be impossible, whatever code runs.
ALTER TABLE inventory_levels
  ADD CONSTRAINT inventory_levels_not_negative
    CHECK (on_hand >= 0 AND reserved >= 0 AND damaged >= 0),
  ADD CONSTRAINT inventory_levels_within_on_hand CHECK (reserved + damaged <= on_hand);

ALTER TABLE stock_movements
  ADD CONSTRAINT stock_movements_delta_not_zero CHECK (quantity_delta <> 0),
  ADD CONSTRAINT stock_movements_note_length CHECK (char_length(note) <= 500);

ALTER TABLE stock_reservations
  ADD CONSTRAINT stock_reservations_quantity_positive CHECK (quantity > 0);

-- References stay inside one tenant (see the catalog migration).
CREATE TRIGGER inventory_levels_variant_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, variant_id ON inventory_levels
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('product_variants', 'variant_id');
CREATE TRIGGER inventory_levels_location_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, location_id ON inventory_levels
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('inventory_locations', 'location_id');
CREATE TRIGGER stock_movements_variant_same_tenant
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('product_variants', 'variant_id');
CREATE TRIGGER stock_movements_location_same_tenant
  BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('inventory_locations', 'location_id');
CREATE TRIGGER stock_reservations_variant_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, variant_id ON stock_reservations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('product_variants', 'variant_id');
CREATE TRIGGER stock_reservations_location_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, location_id ON stock_reservations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('inventory_locations', 'location_id');

-- Row-Level Security: own tenant only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['inventory_locations', 'inventory_levels', 'stock_movements', 'stock_reservations']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
  END LOOP;
END
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON inventory_locations, inventory_levels, stock_reservations
  TO app_user;
-- The movement history is append-only for the application: it can add rows
-- and read them, never change or remove them.
GRANT SELECT, INSERT ON stock_movements TO app_user;
