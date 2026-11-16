-- CreateTable
CREATE TABLE "product_imports" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "created_by_user_id" UUID,
    "file_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'checked',
    "data" JSONB NOT NULL,
    "problems" JSONB NOT NULL DEFAULT '[]',
    "product_count" INTEGER NOT NULL,
    "variant_count" INTEGER NOT NULL,
    "image_count" INTEGER NOT NULL,
    "publish" BOOLEAN NOT NULL DEFAULT false,
    "imported_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_imports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_import_images" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "import_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "locked_until" TIMESTAMPTZ(3),
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_import_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_imports_tenant_id_created_at_idx" ON "product_imports"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "product_import_images_import_id_idx" ON "product_import_images"("import_id");

-- CreateIndex
CREATE INDEX "product_import_images_status_available_at_idx" ON "product_import_images"("status", "available_at");

-- AddForeignKey
ALTER TABLE "product_imports" ADD CONSTRAINT "product_imports_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_import_images" ADD CONSTRAINT "product_import_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_import_images" ADD CONSTRAINT "product_import_images_import_id_fkey" FOREIGN KEY ("import_id") REFERENCES "product_imports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_import_images" ADD CONSTRAINT "product_import_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules the schema language cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE product_imports
  ADD CONSTRAINT product_imports_status_valid CHECK (status IN ('checked', 'imported', 'discarded')),
  ADD CONSTRAINT product_imports_file_name_length CHECK (char_length(file_name) <= 200),
  ADD CONSTRAINT product_imports_counts_valid CHECK (
    product_count >= 0 AND variant_count >= 0 AND image_count >= 0
  );

ALTER TABLE product_import_images
  ADD CONSTRAINT product_import_images_status_valid CHECK (status IN ('pending', 'done', 'failed')),
  ADD CONSTRAINT product_import_images_url_valid CHECK (
    char_length(url) <= 2000 AND (url LIKE 'https://%' OR url LIKE 'http://%')
  ),
  ADD CONSTRAINT product_import_images_error_length CHECK (error IS NULL OR char_length(error) <= 500);

CREATE TRIGGER product_import_images_import_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, import_id ON product_import_images
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('product_imports', 'import_id');
CREATE TRIGGER product_import_images_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON product_import_images
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');

-- Row-Level Security: own tenant only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['product_imports', 'product_import_images']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
  END LOOP;
END
$$;
GRANT SELECT, INSERT, UPDATE ON product_imports, product_import_images TO app_user;
