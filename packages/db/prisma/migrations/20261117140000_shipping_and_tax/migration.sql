-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "shipping_zone_name" TEXT,
ADD COLUMN     "tax_included_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tax_label" TEXT,
ADD COLUMN     "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "shipping_zones" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "countries" TEXT[],
    "rate_amount" INTEGER NOT NULL,
    "free_over_amount" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "shipping_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_settings" (
    "tenant_id" UUID NOT NULL,
    "tax_rate_basis_points" INTEGER NOT NULL DEFAULT 0,
    "tax_included" BOOLEAN NOT NULL DEFAULT true,
    "tax_label" TEXT NOT NULL DEFAULT 'VAT',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "checkout_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "shipments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "courier" TEXT,
    "tracking_reference" TEXT,
    "tracking_url" TEXT,
    "shipped_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shipping_zones_tenant_id_position_idx" ON "shipping_zones"("tenant_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "shipping_zones_tenant_id_name_key" ON "shipping_zones"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "shipments_order_id_key" ON "shipments"("order_id");

-- CreateIndex
CREATE INDEX "shipments_tenant_id_idx" ON "shipments"("tenant_id");

-- AddForeignKey
ALTER TABLE "shipping_zones" ADD CONSTRAINT "shipping_zones_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checkout_settings" ADD CONSTRAINT "checkout_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules the schema language cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE shipping_zones
  ADD CONSTRAINT shipping_zones_name_present CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  ADD CONSTRAINT shipping_zones_countries_valid CHECK (
    countries IS NOT NULL AND cardinality(countries) BETWEEN 1 AND 250
    AND array_to_string(countries, ',') ~ '^[A-Z]{2}(,[A-Z]{2})*$'
  ),
  ADD CONSTRAINT shipping_zones_amounts_valid CHECK (
    rate_amount BETWEEN 0 AND 100000000
    AND (free_over_amount IS NULL OR free_over_amount BETWEEN 0 AND 100000000)
  ),
  ADD CONSTRAINT shipping_zones_currency_valid CHECK (currency ~ '^[A-Z]{3}$');

ALTER TABLE checkout_settings
  ADD CONSTRAINT checkout_settings_rate_valid CHECK (tax_rate_basis_points BETWEEN 0 AND 5000),
  ADD CONSTRAINT checkout_settings_label_valid CHECK (
    btrim(tax_label) <> '' AND char_length(tax_label) <= 30
  );

ALTER TABLE orders
  ADD CONSTRAINT orders_tax_valid CHECK (
    tax_rate_basis_points BETWEEN 0 AND 5000
    AND tax_included_amount >= 0 AND tax_included_amount <= total_amount
  );

ALTER TABLE shipments
  ADD CONSTRAINT shipments_text_lengths CHECK (
    (courier IS NULL OR char_length(courier) <= 100)
    AND (tracking_reference IS NULL OR char_length(tracking_reference) <= 100)
    AND (tracking_url IS NULL OR (char_length(tracking_url) <= 500 AND tracking_url LIKE 'https://%'))
  );

-- What the shopper was charged, and why, never changes after the order is placed.
CREATE OR REPLACE FUNCTION app_private.freeze_order_amounts() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.subtotal_amount, NEW.shipping_amount, NEW.tax_amount, NEW.discount_amount,
      NEW.total_amount, NEW.currency, NEW.number, NEW.payment_method,
      NEW.shipping_zone_name, NEW.tax_rate_basis_points, NEW.tax_included_amount, NEW.tax_label)
     IS DISTINCT FROM
     (OLD.subtotal_amount, OLD.shipping_amount, OLD.tax_amount, OLD.discount_amount,
      OLD.total_amount, OLD.currency, OLD.number, OLD.payment_method,
      OLD.shipping_zone_name, OLD.tax_rate_basis_points, OLD.tax_included_amount, OLD.tax_label) THEN
    RAISE EXCEPTION 'orders: amounts, number and payment method cannot change after the order is placed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER shipments_order_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, order_id ON shipments
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('orders', 'order_id');

-- Row-Level Security: own tenant only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['shipping_zones', 'checkout_settings', 'shipments']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
  END LOOP;
END
$$;
GRANT SELECT, INSERT, UPDATE, DELETE ON shipping_zones TO app_user;
GRANT SELECT, INSERT, UPDATE ON checkout_settings TO app_user;
-- A shipment is a record of what was sent: added and read, never changed or deleted.
GRANT SELECT, INSERT ON shipments TO app_user;
