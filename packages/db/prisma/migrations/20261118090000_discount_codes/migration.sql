-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "discount_code" TEXT;

-- CreateTable
CREATE TABLE "discount_codes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "min_subtotal" INTEGER,
    "starts_at" TIMESTAMPTZ(3),
    "ends_at" TIMESTAMPTZ(3),
    "usage_limit" INTEGER,
    "per_customer_limit" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "discount_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "discount_codes_tenant_id_code_key" ON "discount_codes"("tenant_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "discount_redemptions_order_id_key" ON "discount_redemptions"("order_id");

-- CreateIndex
CREATE INDEX "discount_redemptions_code_id_email_idx" ON "discount_redemptions"("code_id", "email");

-- CreateIndex
CREATE INDEX "discount_redemptions_tenant_id_idx" ON "discount_redemptions"("tenant_id");

-- AddForeignKey
ALTER TABLE "discount_codes" ADD CONSTRAINT "discount_codes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_code_id_fkey" FOREIGN KEY ("code_id") REFERENCES "discount_codes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules the schema language cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE discount_codes
  ADD CONSTRAINT discount_codes_code_format CHECK (code ~ '^[A-Z0-9_-]{3,40}$'),
  ADD CONSTRAINT discount_codes_kind_value CHECK (
    (kind = 'percent' AND value BETWEEN 1 AND 100)
    OR (kind = 'fixed' AND value BETWEEN 1 AND 100000000)
    OR (kind = 'free_delivery' AND value = 0)
  ),
  ADD CONSTRAINT discount_codes_currency_valid CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT discount_codes_limits_valid CHECK (
    (min_subtotal IS NULL OR min_subtotal BETWEEN 0 AND 100000000)
    AND (usage_limit IS NULL OR usage_limit BETWEEN 1 AND 1000000)
    AND (per_customer_limit IS NULL OR per_customer_limit BETWEEN 1 AND 1000)
    AND (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)
  );

ALTER TABLE discount_redemptions
  ADD CONSTRAINT discount_redemptions_amount_valid CHECK (amount >= 0);

-- The code and discount on an order never change after it is placed.
CREATE OR REPLACE FUNCTION app_private.freeze_order_amounts() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.subtotal_amount, NEW.shipping_amount, NEW.tax_amount, NEW.discount_amount,
      NEW.total_amount, NEW.currency, NEW.number, NEW.payment_method,
      NEW.shipping_zone_name, NEW.tax_rate_basis_points, NEW.tax_included_amount, NEW.tax_label,
      NEW.discount_code)
     IS DISTINCT FROM
     (OLD.subtotal_amount, OLD.shipping_amount, OLD.tax_amount, OLD.discount_amount,
      OLD.total_amount, OLD.currency, OLD.number, OLD.payment_method,
      OLD.shipping_zone_name, OLD.tax_rate_basis_points, OLD.tax_included_amount, OLD.tax_label,
      OLD.discount_code) THEN
    RAISE EXCEPTION 'orders: amounts, number and payment method cannot change after the order is placed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER discount_redemptions_code_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, code_id ON discount_redemptions
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('discount_codes', 'code_id');
CREATE TRIGGER discount_redemptions_order_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, order_id ON discount_redemptions
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('orders', 'order_id');

-- Row-Level Security: own tenant only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['discount_codes', 'discount_redemptions']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
  END LOOP;
END
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON discount_codes TO app_user;
-- Which order used a code is a record: added and read, never changed.
GRANT SELECT, INSERT ON discount_redemptions TO app_user;
