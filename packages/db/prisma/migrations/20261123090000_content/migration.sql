-- CreateTable
CREATE TABLE "content_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "alt_text" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "usage_note" TEXT NOT NULL DEFAULT '',
    "created_by_user_id" UUID,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_posts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "format" TEXT NOT NULL DEFAULT 'post',
    "caption" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "planned_for" TIMESTAMPTZ(3),
    "review_note" TEXT,
    "submitted_at" TIMESTAMPTZ(3),
    "approved_by_user_id" UUID,
    "approved_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "published_url" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "content_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_post_assets" (
    "tenant_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "content_post_assets_pkey" PRIMARY KEY ("post_id","asset_id")
);

-- CreateTable
CREATE TABLE "content_post_products" (
    "tenant_id" UUID NOT NULL,
    "post_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "content_post_products_pkey" PRIMARY KEY ("post_id","product_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "content_assets_media_asset_id_key" ON "content_assets"("media_asset_id");

-- CreateIndex
CREATE INDEX "content_assets_tenant_id_created_at_idx" ON "content_assets"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "content_posts_tenant_id_status_planned_for_idx" ON "content_posts"("tenant_id", "status", "planned_for");

-- CreateIndex
CREATE INDEX "content_posts_tenant_id_planned_for_idx" ON "content_posts"("tenant_id", "planned_for");

-- CreateIndex
CREATE INDEX "content_post_assets_tenant_id_idx" ON "content_post_assets"("tenant_id");

-- CreateIndex
CREATE INDEX "content_post_assets_asset_id_idx" ON "content_post_assets"("asset_id");

-- CreateIndex
CREATE INDEX "content_post_products_tenant_id_idx" ON "content_post_products"("tenant_id");

-- CreateIndex
CREATE INDEX "content_post_products_product_id_idx" ON "content_post_products"("product_id");

-- AddForeignKey
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_posts" ADD CONSTRAINT "content_posts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_post_assets" ADD CONSTRAINT "content_post_assets_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_post_assets" ADD CONSTRAINT "content_post_assets_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "content_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_post_products" ADD CONSTRAINT "content_post_products_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "content_posts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_post_products" ADD CONSTRAINT "content_post_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Hand-written: rules the schema language cannot express.
ALTER TABLE content_assets
  ADD CONSTRAINT content_assets_text_valid CHECK (
    btrim(title) <> '' AND char_length(title) <= 120 AND char_length(alt_text) <= 300
    AND char_length(usage_note) <= 500 AND cardinality(tags) <= 20
  );
ALTER TABLE content_posts
  ADD CONSTRAINT content_posts_channel_valid CHECK (channel IN ('instagram', 'facebook', 'tiktok', 'whatsapp', 'other')),
  ADD CONSTRAINT content_posts_format_valid CHECK (format IN ('post', 'reel', 'story', 'carousel')),
  ADD CONSTRAINT content_posts_status_valid CHECK (status IN ('draft', 'in_review', 'changes_requested', 'approved', 'published')),
  ADD CONSTRAINT content_posts_text_valid CHECK (
    btrim(title) <> '' AND char_length(title) <= 120 AND char_length(caption) <= 5000
    AND (review_note IS NULL OR char_length(review_note) <= 1000)
    AND (published_url IS NULL OR published_url ~ '^https://')
  ),
  -- Approved and published posts carry who approved them; published ones, when.
  ADD CONSTRAINT content_posts_approval_recorded CHECK (
    status NOT IN ('approved', 'published') OR (approved_by_user_id IS NOT NULL AND approved_at IS NOT NULL)
  ),
  ADD CONSTRAINT content_posts_published_recorded CHECK (status <> 'published' OR published_at IS NOT NULL);

ALTER TABLE content_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_assets FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE content_posts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_posts FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE content_post_assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_post_assets FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE content_post_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON content_post_products FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON content_assets TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON content_posts, content_post_assets, content_post_products TO app_user;

CREATE TRIGGER content_assets_media_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, media_asset_id ON content_assets
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('media_assets', 'media_asset_id');
CREATE TRIGGER content_post_assets_post_same_tenant
  BEFORE INSERT OR UPDATE ON content_post_assets
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('content_posts', 'post_id');
CREATE TRIGGER content_post_assets_asset_same_tenant
  BEFORE INSERT OR UPDATE ON content_post_assets
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('content_assets', 'asset_id');
CREATE TRIGGER content_post_products_post_same_tenant
  BEFORE INSERT OR UPDATE ON content_post_products
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('content_posts', 'post_id');
CREATE TRIGGER content_post_products_product_same_tenant
  BEFORE INSERT OR UPDATE ON content_post_products
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');
