-- CreateEnum
CREATE TYPE "media_kind" AS ENUM ('image', 'video');

-- CreateEnum
CREATE TYPE "media_status" AS ENUM ('processing', 'ready', 'failed');

-- AlterTable
ALTER TABLE "brands" ADD COLUMN     "logo_asset_id" UUID;

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "image_asset_id" UUID;

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" "media_kind" NOT NULL DEFAULT 'image',
    "status" "media_status" NOT NULL DEFAULT 'processing',
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "checksum" TEXT NOT NULL,
    "variants" JSONB NOT NULL DEFAULT '[]',
    "processing_error" TEXT,
    "uploaded_by" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_images" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "media_asset_id" UUID NOT NULL,
    "alt_text" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_images_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_storage_key_key" ON "media_assets"("storage_key");

-- CreateIndex
CREATE INDEX "media_assets_tenant_id_created_at_idx" ON "media_assets"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "media_assets_status_created_at_idx" ON "media_assets"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "product_images_media_asset_id_key" ON "product_images"("media_asset_id");

-- CreateIndex
CREATE INDEX "product_images_product_id_position_idx" ON "product_images"("product_id", "position");

-- CreateIndex
CREATE INDEX "product_images_tenant_id_idx" ON "product_images"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "brands_logo_asset_id_key" ON "brands"("logo_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "categories_image_asset_id_key" ON "categories"("image_asset_id");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_image_asset_id_fkey" FOREIGN KEY ("image_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_logo_asset_id_fkey" FOREIGN KEY ("logo_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_media_asset_id_fkey" FOREIGN KEY ("media_asset_id") REFERENCES "media_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written from here: rules Prisma cannot express.
-- ---------------------------------------------------------------------------

-- --- Check constraints --------------------------------------------------------
ALTER TABLE media_assets
  -- Every file a tenant owns is stored under its own prefix.
  ADD CONSTRAINT media_assets_key_in_tenant_prefix
    CHECK (storage_key LIKE 'public/' || tenant_id::text || '/%'),
  ADD CONSTRAINT media_assets_measures_valid
    CHECK (bytes > 0 AND width > 0 AND height > 0),
  ADD CONSTRAINT media_assets_checksum_format CHECK (checksum ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT media_assets_variants_is_list CHECK (jsonb_typeof(variants) = 'array');

ALTER TABLE product_images
  ADD CONSTRAINT product_images_position_valid CHECK (position >= 0),
  ADD CONSTRAINT product_images_alt_text_length CHECK (char_length(alt_text) <= 300);

-- --- References stay inside one tenant (see the catalog migration) ------------
CREATE TRIGGER product_images_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON product_images
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');
CREATE TRIGGER product_images_variant_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, variant_id ON product_images
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('product_variants', 'variant_id');
CREATE TRIGGER product_images_asset_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, media_asset_id ON product_images
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('media_assets', 'media_asset_id');
CREATE TRIGGER categories_image_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, image_asset_id ON categories
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('media_assets', 'image_asset_id');
CREATE TRIGGER brands_logo_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, logo_asset_id ON brands
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('media_assets', 'logo_asset_id');

-- An image tied to a variant must be an image of that variant's product.
CREATE OR REPLACE FUNCTION app_private.check_image_variant_of_product() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
BEGIN
  IF NEW.variant_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM product_variants WHERE id = NEW.variant_id AND product_id = NEW.product_id
  ) THEN
    RAISE EXCEPTION 'product_images.variant_id: variant belongs to another product'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app_private.check_image_variant_of_product() FROM PUBLIC;

CREATE TRIGGER product_images_variant_of_product
  BEFORE INSERT OR UPDATE OF product_id, variant_id ON product_images
  FOR EACH ROW EXECUTE FUNCTION app_private.check_image_variant_of_product();

-- --- Row-Level Security: full access, own tenant only -----------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['media_assets', 'product_images']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END
$$;
