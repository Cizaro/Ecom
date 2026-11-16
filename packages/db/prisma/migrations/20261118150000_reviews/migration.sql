-- CreateTable
CREATE TABLE "product_reviews" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "customer_id" UUID,
    "order_id" UUID,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "body" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reply" TEXT,
    "replied_at" TIMESTAMPTZ(3),
    "moderated_at" TIMESTAMPTZ(3),
    "moderated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_reports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "review_id" UUID NOT NULL,
    "customer_id" UUID,
    "reason" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "review_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_reviews_tenant_id_status_created_at_idx" ON "product_reviews"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "product_reviews_product_id_status_created_at_idx" ON "product_reviews"("product_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_reviews_product_id_customer_id_key" ON "product_reviews"("product_id", "customer_id");

-- CreateIndex
CREATE INDEX "review_reports_tenant_id_idx" ON "review_reports"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "review_reports_review_id_customer_id_key" ON "review_reports"("review_id", "customer_id");

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_reviews" ADD CONSTRAINT "product_reviews_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_review_id_fkey" FOREIGN KEY ("review_id") REFERENCES "product_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules the schema language cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE product_reviews
  ADD CONSTRAINT product_reviews_rating_valid CHECK (rating BETWEEN 1 AND 5),
  ADD CONSTRAINT product_reviews_text_valid CHECK (
    btrim(body) <> '' AND char_length(body) <= 2000
    AND (title IS NULL OR char_length(title) <= 120)
    AND btrim(author_name) <> '' AND char_length(author_name) <= 60
    AND (reply IS NULL OR char_length(reply) <= 2000)
  ),
  ADD CONSTRAINT product_reviews_status_valid CHECK (
    status IN ('pending', 'approved', 'rejected', 'hidden')
  );

ALTER TABLE review_reports
  ADD CONSTRAINT review_reports_reason_valid CHECK (
    reason IN ('spam', 'offensive', 'not_about_product', 'other')
  );

-- A review is written only by a customer who bought the product and received
-- it: the order must be theirs, contain the product, and have been sent.
CREATE OR REPLACE FUNCTION app_private.check_verified_review() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM orders o
      JOIN order_items i ON i.order_id = o.id
      JOIN product_variants v ON v.id = i.variant_id
     WHERE o.id = NEW.order_id
       AND o.tenant_id = NEW.tenant_id
       AND o.customer_id = NEW.customer_id
       AND o.status IN ('fulfilled', 'refunded')
       AND v.product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'product_reviews: only a customer who received the product can review it'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app_private.check_verified_review() FROM PUBLIC;
CREATE TRIGGER product_reviews_verified
  BEFORE INSERT ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION app_private.check_verified_review();

CREATE TRIGGER product_reviews_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');
CREATE TRIGGER product_reviews_customer_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');
CREATE TRIGGER product_reviews_order_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, order_id ON product_reviews
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('orders', 'order_id');
CREATE TRIGGER review_reports_review_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, review_id ON review_reports
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('product_reviews', 'review_id');
CREATE TRIGGER review_reports_customer_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON review_reports
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');

-- Row-Level Security: own tenant only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_reviews', 'review_reports']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
  END LOOP;
END
$$;
-- Reviews are moderated (hidden), never deleted by the application.
GRANT SELECT, INSERT, UPDATE ON product_reviews TO app_user;
GRANT SELECT, INSERT ON review_reports TO app_user;
