-- CreateTable
CREATE TABLE "analytics_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "product_id" UUID,
    "utm_link_id" UUID,
    "query" TEXT,
    "result_count" INTEGER,
    "locale" TEXT,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "analytics_events_tenant_id_name_occurred_at_idx" ON "analytics_events"("tenant_id", "name", "occurred_at");

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analytics_events" ADD CONSTRAINT "analytics_events_utm_link_id_fkey" FOREIGN KEY ("utm_link_id") REFERENCES "utm_links"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Hand-written: rules the schema language cannot express.
-- Shop events carry no personal details: no customer, session, address or IP.
ALTER TABLE analytics_events
  ADD CONSTRAINT analytics_events_name_valid CHECK (
    name IN ('product_view', 'add_to_cart', 'checkout_started', 'search', 'link_click')
  ),
  ADD CONSTRAINT analytics_events_query_valid CHECK (
    (name = 'search') = (query IS NOT NULL) AND (query IS NULL OR char_length(query) BETWEEN 1 AND 100)
  ),
  ADD CONSTRAINT analytics_events_result_count_valid CHECK (result_count IS NULL OR result_count >= 0);

CREATE TRIGGER analytics_events_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON analytics_events
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');
CREATE TRIGGER analytics_events_link_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, utm_link_id ON analytics_events
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('utm_links', 'utm_link_id');

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON analytics_events FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

-- Recorded once, never changed by the app.
GRANT SELECT, INSERT ON analytics_events TO app_user;
