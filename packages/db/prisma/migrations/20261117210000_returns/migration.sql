-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "refunded_amount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "order_returns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "refund_amount" INTEGER NOT NULL DEFAULT 0,
    "refund_method" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_return_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "order_item_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "condition" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "order_return_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "order_returns_order_id_idx" ON "order_returns"("order_id");

-- CreateIndex
CREATE INDEX "order_returns_tenant_id_created_at_idx" ON "order_returns"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "order_return_items_return_id_idx" ON "order_return_items"("return_id");

-- CreateIndex
CREATE INDEX "order_return_items_order_item_id_idx" ON "order_return_items"("order_item_id");

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_returns" ADD CONSTRAINT "order_returns_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "order_returns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_return_items" ADD CONSTRAINT "order_return_items_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules the schema language cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE order_returns
  ADD CONSTRAINT order_returns_reason_valid CHECK (
    reason IN ('changed_mind', 'damaged', 'wrong_item', 'not_as_described', 'other')
  ),
  ADD CONSTRAINT order_returns_note_length CHECK (note IS NULL OR char_length(note) <= 500),
  ADD CONSTRAINT order_returns_refund_valid CHECK (
    (refund_amount = 0 AND refund_method IS NULL)
    OR (refund_amount > 0 AND refund_method IN ('cash', 'bank_transfer', 'other'))
  );

ALTER TABLE order_return_items
  ADD CONSTRAINT order_return_items_quantity_valid CHECK (quantity BETWEEN 1 AND 10000),
  ADD CONSTRAINT order_return_items_condition_valid CHECK (condition IN ('resellable', 'damaged'));

-- Money given back never exceeds what the order cost, and never goes down.
ALTER TABLE orders
  ADD CONSTRAINT orders_refunded_valid CHECK (refunded_amount BETWEEN 0 AND total_amount);

CREATE OR REPLACE FUNCTION app_private.refunds_only_grow() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NEW.refunded_amount < OLD.refunded_amount THEN
    RAISE EXCEPTION 'orders: refunded_amount cannot go down' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER orders_refunds_only_grow
  BEFORE UPDATE OF refunded_amount ON orders
  FOR EACH ROW EXECUTE FUNCTION app_private.refunds_only_grow();

-- A returned line belongs to the return's own order, and no more can come
-- back than was bought (across all returns of that line).
CREATE OR REPLACE FUNCTION app_private.check_return_item() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  bought integer;
  returned integer;
BEGIN
  SELECT oi.quantity INTO bought
    FROM order_items oi
    JOIN order_returns r ON r.id = NEW.return_id
   WHERE oi.id = NEW.order_item_id AND oi.order_id = r.order_id
   FOR UPDATE OF oi;
  IF bought IS NULL THEN
    RAISE EXCEPTION 'order_return_items: the item is not on the return''s order'
      USING ERRCODE = '23514';
  END IF;
  SELECT coalesce(sum(quantity), 0) INTO returned
    FROM order_return_items WHERE order_item_id = NEW.order_item_id;
  IF returned + NEW.quantity > bought THEN
    RAISE EXCEPTION 'order_return_items: more returned than bought' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app_private.check_return_item() FROM PUBLIC;
CREATE TRIGGER order_return_items_check
  BEFORE INSERT ON order_return_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_return_item();

CREATE TRIGGER order_returns_order_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, order_id ON order_returns
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('orders', 'order_id');
CREATE TRIGGER order_return_items_return_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, return_id ON order_return_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('order_returns', 'return_id');
CREATE TRIGGER order_return_items_item_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, order_item_id ON order_return_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('order_items', 'order_item_id');

-- Row-Level Security: own tenant only. Returns are a record: added and read, never changed.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['order_returns', 'order_return_items']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
  END LOOP;
END
$$;
GRANT SELECT, INSERT ON order_returns, order_return_items TO app_user;
