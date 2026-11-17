-- CreateTable
CREATE TABLE "ugc_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "media_asset_id" UUID,
    "kind" "media_kind" NOT NULL,
    "source" TEXT NOT NULL,
    "customer_id" UUID,
    "product_id" UUID,
    "caption" TEXT,
    "credit_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "permission_text" TEXT NOT NULL,
    "permission_version" TEXT NOT NULL,
    "permission_granted_at" TIMESTAMPTZ(3) NOT NULL,
    "permission_withdrawn_at" TIMESTAMPTZ(3),
    "source_url" TEXT,
    "created_by_user_id" UUID,
    "moderated_at" TIMESTAMPTZ(3),
    "moderated_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ugc_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ugc_items_media_asset_id_key" ON "ugc_items"("media_asset_id");

-- CreateIndex
CREATE INDEX "ugc_items_tenant_id_status_created_at_idx" ON "ugc_items"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "ugc_items_product_id_status_idx" ON "ugc_items"("product_id", "status");

-- CreateIndex
CREATE INDEX "ugc_items_customer_id_created_at_idx" ON "ugc_items"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "ugc_items" ADD CONSTRAINT "ugc_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ugc_items" ADD CONSTRAINT "ugc_items_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ugc_items" ADD CONSTRAINT "ugc_items_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ugc_items" ADD CONSTRAINT "ugc_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules the schema language cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE ugc_items
  ADD CONSTRAINT ugc_items_source_valid CHECK (source IN ('customer', 'staff')),
  ADD CONSTRAINT ugc_items_status_valid CHECK (
    status IN ('pending', 'approved', 'rejected', 'hidden', 'withdrawn', 'removed')
  ),
  ADD CONSTRAINT ugc_items_text_valid CHECK (
    (caption IS NULL OR char_length(caption) <= 300)
    AND btrim(credit_name) <> '' AND char_length(credit_name) <= 60
    AND btrim(permission_text) <> '' AND char_length(permission_text) <= 2000
    AND char_length(permission_version) <= 40
    AND (source_url IS NULL OR (char_length(source_url) <= 500 AND source_url LIKE 'https://%'))
  ),
  -- A customer's item belongs to a customer; a staff item names who added it.
  ADD CONSTRAINT ugc_items_owner_valid CHECK (
    (source = 'customer' AND (customer_id IS NOT NULL OR status IN ('withdrawn', 'removed')))
    OR (source = 'staff' AND source_url IS NOT NULL)
  ),
  -- Nothing is shown without a file and live permission.
  ADD CONSTRAINT ugc_items_shown_needs_permission CHECK (
    status <> 'approved' OR (media_asset_id IS NOT NULL AND permission_withdrawn_at IS NULL)
  ),
  -- Withdrawn means the file is gone.
  ADD CONSTRAINT ugc_items_withdrawn_has_no_file CHECK (
    status NOT IN ('withdrawn', 'removed') OR media_asset_id IS NULL
  );

CREATE TRIGGER ugc_items_asset_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, media_asset_id ON ugc_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('media_assets', 'media_asset_id');
CREATE TRIGGER ugc_items_customer_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON ugc_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');
CREATE TRIGGER ugc_items_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON ugc_items
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');

-- Row-Level Security: own tenant only. Kept as a record: never deleted by the application.
ALTER TABLE ugc_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ugc_items FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON ugc_items TO app_user;
