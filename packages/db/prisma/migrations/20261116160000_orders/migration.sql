-- CreateEnum
CREATE TYPE "order_status" AS ENUM ('pending_payment', 'paid', 'fulfilled', 'cancelled', 'refunded');

-- CreateEnum
CREATE TYPE "payment_status" AS ENUM ('pending', 'succeeded', 'failed', 'cancelled');

-- CreateTable
CREATE TABLE "order_counters" (
    "tenant_id" UUID NOT NULL,
    "next_number" INTEGER NOT NULL DEFAULT 1001,

    CONSTRAINT "order_counters_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "order_status" NOT NULL DEFAULT 'pending_payment',
    "customer_id" UUID,
    "cart_id" UUID,
    "email" TEXT NOT NULL,
    "access_key_hash" TEXT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "subtotal_amount" INTEGER NOT NULL,
    "shipping_amount" INTEGER NOT NULL DEFAULT 0,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "discount_amount" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL,
    "shipping_address" JSONB NOT NULL,
    "pay_by" TIMESTAMPTZ(3) NOT NULL,
    "placed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "variant_id" UUID,
    "product_name" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "color" TEXT,
    "size" TEXT,
    "quantity" INTEGER NOT NULL,
    "unit_price_amount" INTEGER NOT NULL,
    "line_total_amount" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "from_status" "order_status",
    "to_status" "order_status",
    "actor_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_payment_id" TEXT NOT NULL,
    "status" "payment_status" NOT NULL DEFAULT 'pending',
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "method_brand" TEXT,
    "method_last4" TEXT,
    "failure_message" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "payment_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "signature_verified" BOOLEAN NOT NULL,
    "processed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "orders_access_key_hash_key" ON "orders"("access_key_hash");

-- CreateIndex
CREATE INDEX "orders_tenant_id_placed_at_idx" ON "orders"("tenant_id", "placed_at");

-- CreateIndex
CREATE INDEX "orders_customer_id_placed_at_idx" ON "orders"("customer_id", "placed_at");

-- CreateIndex
CREATE INDEX "orders_status_pay_by_idx" ON "orders"("status", "pay_by");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_number_key" ON "orders"("tenant_id", "number");

-- CreateIndex
CREATE INDEX "order_items_order_id_idx" ON "order_items"("order_id");

-- CreateIndex
CREATE INDEX "order_items_tenant_id_idx" ON "order_items"("tenant_id");

-- CreateIndex
CREATE INDEX "order_events_order_id_created_at_idx" ON "order_events"("order_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");

-- CreateIndex
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- CreateIndex
CREATE INDEX "payments_tenant_id_idx" ON "payments"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_events_payment_id_idx" ON "payment_events"("payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_provider_event_id_key" ON "payment_events"("provider", "provider_event_id");

-- AddForeignKey
ALTER TABLE "order_counters" ADD CONSTRAINT "order_counters_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_cart_id_fkey" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written from here: rules Prisma cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE orders
  ADD CONSTRAINT orders_number_positive CHECK (number > 0),
  ADD CONSTRAINT orders_amounts_valid CHECK (
    subtotal_amount >= 0 AND shipping_amount >= 0 AND tax_amount >= 0
    AND discount_amount >= 0 AND total_amount >= 0
    AND total_amount = subtotal_amount + shipping_amount + tax_amount - discount_amount
  ),
  ADD CONSTRAINT orders_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT orders_email_lowercase CHECK (email = lower(email)),
  ADD CONSTRAINT orders_access_key_hash_format CHECK (access_key_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE order_items
  ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0),
  ADD CONSTRAINT order_items_amounts_valid CHECK (
    unit_price_amount >= 0 AND line_total_amount = unit_price_amount * quantity
  );

ALTER TABLE payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0),
  ADD CONSTRAINT payments_last4_format CHECK (method_last4 IS NULL OR method_last4 ~ '^[0-9]{4}$');

-- An order's status moves only along these steps:
--   pending_payment -> paid | cancelled
--   paid            -> fulfilled | cancelled | refunded
--   fulfilled       -> refunded
CREATE OR REPLACE FUNCTION app_private.check_order_transition() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  IF (OLD.status, NEW.status) IN (
    ('pending_payment', 'paid'), ('pending_payment', 'cancelled'),
    ('paid', 'fulfilled'), ('paid', 'cancelled'), ('paid', 'refunded'),
    ('fulfilled', 'refunded')
  ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'orders.status: % cannot become %', OLD.status, NEW.status
    USING ERRCODE = '23514';
END
$$;
CREATE TRIGGER orders_status_transition
  BEFORE UPDATE OF status ON orders
  FOR EACH ROW EXECUTE FUNCTION app_private.check_order_transition();

-- What an order says it cost never changes after it is placed.
CREATE OR REPLACE FUNCTION app_private.freeze_order_amounts() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF (NEW.subtotal_amount, NEW.shipping_amount, NEW.tax_amount, NEW.discount_amount,
      NEW.total_amount, NEW.currency, NEW.number)
     IS DISTINCT FROM
     (OLD.subtotal_amount, OLD.shipping_amount, OLD.tax_amount, OLD.discount_amount,
      OLD.total_amount, OLD.currency, OLD.number) THEN
    RAISE EXCEPTION 'orders: amounts and number cannot change after the order is placed'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER orders_amounts_frozen
  BEFORE UPDATE ON orders
  FOR EACH ROW EXECUTE FUNCTION app_private.freeze_order_amounts();

-- References stay inside one tenant (see the catalog migration).
CREATE TRIGGER orders_customer_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON orders
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');
CREATE TRIGGER orders_cart_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, cart_id ON orders
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('carts', 'cart_id');
CREATE TRIGGER order_items_order_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, order_id ON order_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('orders', 'order_id');
CREATE TRIGGER order_items_variant_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, variant_id ON order_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('product_variants', 'variant_id');
CREATE TRIGGER order_events_order_same_tenant
  BEFORE INSERT ON order_events
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('orders', 'order_id');
CREATE TRIGGER payments_order_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, order_id ON payments
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('orders', 'order_id');
CREATE TRIGGER payment_events_payment_same_tenant
  BEFORE INSERT ON payment_events
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('payments', 'payment_id');

-- Row-Level Security: own tenant only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'order_counters', 'orders', 'order_items', 'order_events', 'payments', 'payment_events'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
  END LOOP;
END
$$;
GRANT SELECT, INSERT, UPDATE ON order_counters, orders, payments TO app_user;
-- Order lines, the order history and payment notifications are a record:
-- the application can add and read them, never change or delete them.
GRANT SELECT, INSERT ON order_items, order_events, payment_events TO app_user;
