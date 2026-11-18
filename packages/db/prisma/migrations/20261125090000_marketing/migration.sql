-- AlterTable
ALTER TABLE "content_posts" ADD COLUMN     "campaign_id" UUID;

-- CreateTable
CREATE TABLE "marketing_campaigns" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'planned',
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "audience" TEXT NOT NULL DEFAULT '',
    "key_message" TEXT NOT NULL DEFAULT '',
    "offer" TEXT NOT NULL DEFAULT '',
    "budget_amount" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "discount_code_id" UUID,
    "segment_id" UUID,
    "notes" TEXT NOT NULL DEFAULT '',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketing_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campaign_products" (
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "marketing_campaign_products_pkey" PRIMARY KEY ("campaign_id","product_id")
);

-- CreateTable
CREATE TABLE "customer_segments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customer_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utm_links" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "campaign_id" UUID,
    "post_id" UUID,
    "label" TEXT NOT NULL,
    "destination_path" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "medium" TEXT NOT NULL,
    "utm_campaign" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "short_code" TEXT NOT NULL,
    "click_count" INTEGER NOT NULL DEFAULT 0,
    "last_clicked_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utm_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "marketing_campaigns_tenant_id_starts_on_idx" ON "marketing_campaigns"("tenant_id", "starts_on");

-- CreateIndex
CREATE INDEX "marketing_campaign_products_tenant_id_idx" ON "marketing_campaign_products"("tenant_id");

-- CreateIndex
CREATE INDEX "marketing_campaign_products_product_id_idx" ON "marketing_campaign_products"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "customer_segments_tenant_id_name_key" ON "customer_segments"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "utm_links_campaign_id_idx" ON "utm_links"("campaign_id");

-- CreateIndex
CREATE INDEX "utm_links_post_id_idx" ON "utm_links"("post_id");

-- CreateIndex
CREATE UNIQUE INDEX "utm_links_tenant_id_short_code_key" ON "utm_links"("tenant_id", "short_code");

-- CreateIndex
CREATE INDEX "content_posts_campaign_id_idx" ON "content_posts"("campaign_id");

-- AddForeignKey
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_discount_code_id_fkey" FOREIGN KEY ("discount_code_id") REFERENCES "discount_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaigns" ADD CONSTRAINT "marketing_campaigns_segment_id_fkey" FOREIGN KEY ("segment_id") REFERENCES "customer_segments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_products" ADD CONSTRAINT "marketing_campaign_products_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketing_campaign_products" ADD CONSTRAINT "marketing_campaign_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_segments" ADD CONSTRAINT "customer_segments_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utm_links" ADD CONSTRAINT "utm_links_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utm_links" ADD CONSTRAINT "utm_links_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "marketing_campaigns"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "utm_links" ADD CONSTRAINT "utm_links_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_posts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: rules the schema language cannot express.
ALTER TABLE marketing_campaigns
  ADD CONSTRAINT marketing_campaigns_objective_valid CHECK (objective IN ('awareness', 'traffic', 'sales', 'launch', 'loyalty')),
  ADD CONSTRAINT marketing_campaigns_status_valid CHECK (status IN ('planned', 'active', 'finished', 'cancelled')),
  ADD CONSTRAINT marketing_campaigns_dates_valid CHECK (ends_on IS NULL OR ends_on >= starts_on),
  ADD CONSTRAINT marketing_campaigns_channels_valid CHECK (
    channels <@ ARRAY['instagram', 'facebook', 'tiktok', 'whatsapp', 'email', 'in_store', 'other']::text[]
  ),
  ADD CONSTRAINT marketing_campaigns_budget_valid CHECK (budget_amount IS NULL OR budget_amount >= 0),
  ADD CONSTRAINT marketing_campaigns_text_valid CHECK (
    btrim(name) <> '' AND char_length(name) <= 120 AND char_length(audience) <= 1000
    AND char_length(key_message) <= 1000 AND char_length(offer) <= 500 AND char_length(notes) <= 2000
  );
ALTER TABLE customer_segments
  ADD CONSTRAINT customer_segments_name_valid CHECK (btrim(name) <> '' AND char_length(name) <= 80),
  ADD CONSTRAINT customer_segments_rules_object CHECK (jsonb_typeof(rules) = 'object');
ALTER TABLE utm_links
  ADD CONSTRAINT utm_links_destination_valid CHECK (
    destination_path ~ '^/' AND destination_path !~ '^//' AND position(chr(92) in destination_path) = 0
    AND char_length(destination_path) <= 500
  ),
  ADD CONSTRAINT utm_links_tags_valid CHECK (
    source ~ '^[a-z0-9_.-]{1,60}$' AND medium ~ '^[a-z0-9_.-]{1,60}$'
    AND utm_campaign ~ '^[a-z0-9_.-]{1,80}$' AND content ~ '^[a-z0-9_.-]{0,80}$'
  ),
  ADD CONSTRAINT utm_links_code_valid CHECK (short_code ~ '^[a-z0-9]{6,16}$'),
  ADD CONSTRAINT utm_links_label_valid CHECK (btrim(label) <> '' AND char_length(label) <= 120),
  ADD CONSTRAINT utm_links_clicks_valid CHECK (click_count >= 0);

ALTER TABLE marketing_campaigns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing_campaigns FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE marketing_campaign_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON marketing_campaign_products FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE customer_segments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON customer_segments FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE utm_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON utm_links FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON marketing_campaigns, marketing_campaign_products, customer_segments, utm_links TO app_user;

CREATE TRIGGER marketing_campaigns_code_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, discount_code_id ON marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('discount_codes', 'discount_code_id');
CREATE TRIGGER marketing_campaigns_segment_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, segment_id ON marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customer_segments', 'segment_id');
CREATE TRIGGER marketing_campaign_products_campaign_same_tenant
  BEFORE INSERT OR UPDATE ON marketing_campaign_products
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('marketing_campaigns', 'campaign_id');
CREATE TRIGGER marketing_campaign_products_product_same_tenant
  BEFORE INSERT OR UPDATE ON marketing_campaign_products
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');
CREATE TRIGGER utm_links_campaign_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, campaign_id ON utm_links
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('marketing_campaigns', 'campaign_id');
CREATE TRIGGER utm_links_post_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, post_id ON utm_links
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('content_posts', 'post_id');
CREATE TRIGGER content_posts_campaign_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, campaign_id ON content_posts
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('marketing_campaigns', 'campaign_id');
