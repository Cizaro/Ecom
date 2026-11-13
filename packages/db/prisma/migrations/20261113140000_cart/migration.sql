-- CreateEnum
CREATE TYPE "cart_status" AS ENUM ('active', 'converted');

-- CreateTable
CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "cart_status" NOT NULL DEFAULT 'active',
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "carts_token_hash_key" ON "carts"("token_hash");

-- CreateIndex
CREATE INDEX "carts_tenant_id_status_expires_at_idx" ON "carts"("tenant_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "carts_expires_at_idx" ON "carts"("expires_at");

-- CreateIndex
CREATE INDEX "cart_items_tenant_id_idx" ON "cart_items"("tenant_id");

-- CreateIndex
CREATE INDEX "cart_items_variant_id_idx" ON "cart_items"("variant_id");

-- CreateIndex
CREATE UNIQUE INDEX "cart_items_cart_id_variant_id_key" ON "cart_items"("cart_id", "variant_id");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written from here: rules Prisma cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE carts
  ADD CONSTRAINT carts_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT carts_currency_format CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE cart_items
  ADD CONSTRAINT cart_items_quantity_valid CHECK (quantity BETWEEN 1 AND 99),
  ADD CONSTRAINT cart_items_unit_price_valid CHECK (unit_price_amount >= 0);

-- A cart's items and their variants stay inside the cart's tenant.
CREATE TRIGGER cart_items_cart_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, cart_id ON cart_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('carts', 'cart_id');
CREATE TRIGGER cart_items_variant_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, variant_id ON cart_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('product_variants', 'variant_id');

-- Row-Level Security: full access, own tenant only. Which cart inside the
-- tenant a visitor may see is decided by the cart token, in the cart service.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['carts', 'cart_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END
$$;
