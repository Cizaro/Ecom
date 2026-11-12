-- CreateEnum
CREATE TYPE "product_status" AS ENUM ('draft', 'active', 'archived');

-- CreateEnum
CREATE TYPE "variant_status" AS ENUM ('active', 'inactive');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "parent_id" UUID,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "seo_title" TEXT,
    "seo_description" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "brands" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "brands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "short_description" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "seo_title" TEXT,
    "seo_description" TEXT,
    "brand_id" UUID,
    "category_id" UUID,
    "audience_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "material" TEXT,
    "care_info" TEXT,
    "tax_class" TEXT,
    "status" "product_status" NOT NULL DEFAULT 'draft',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "is_new_arrival" BOOLEAN NOT NULL DEFAULT false,
    "is_best_seller" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "color" TEXT,
    "size" TEXT,
    "option_values" JSONB NOT NULL DEFAULT '{}',
    "price_amount" INTEGER NOT NULL,
    "discount_price_amount" INTEGER,
    "compare_at_amount" INTEGER,
    "cost_amount" INTEGER,
    "currency" CHAR(3) NOT NULL,
    "weight_grams" INTEGER,
    "length_mm" INTEGER,
    "width_mm" INTEGER,
    "height_mm" INTEGER,
    "low_stock_threshold" INTEGER,
    "position" INTEGER NOT NULL DEFAULT 0,
    "status" "variant_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attributes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "categories_tenant_id_parent_id_position_idx" ON "categories"("tenant_id", "parent_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenant_id_slug_key" ON "categories"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "brands_tenant_id_name_idx" ON "brands"("tenant_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "brands_tenant_id_slug_key" ON "brands"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "products_tenant_id_status_created_at_idx" ON "products"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE INDEX "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");

-- CreateIndex
CREATE INDEX "products_tenant_id_brand_id_idx" ON "products"("tenant_id", "brand_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_slug_key" ON "products"("tenant_id", "slug");

-- CreateIndex
CREATE INDEX "product_variants_product_id_position_idx" ON "product_variants"("product_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_tenant_id_sku_key" ON "product_variants"("tenant_id", "sku");

-- CreateIndex
CREATE INDEX "product_attributes_tenant_id_idx" ON "product_attributes"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "product_attributes_product_id_key_key" ON "product_attributes"("product_id", "key");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "brands" ADD CONSTRAINT "brands_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_brand_id_fkey" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- --- Constraints Prisma cannot express --------------------------------------
-- Slugs appear in URLs: lowercase letters and digits joined by single hyphens.
ALTER TABLE categories ADD CONSTRAINT categories_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120);
ALTER TABLE brands ADD CONSTRAINT brands_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120);
ALTER TABLE products ADD CONSTRAINT products_slug_format
  CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 120);

ALTER TABLE categories ADD CONSTRAINT categories_name_not_blank CHECK (btrim(name) <> '');
ALTER TABLE brands ADD CONSTRAINT brands_name_not_blank CHECK (btrim(name) <> '');
ALTER TABLE products ADD CONSTRAINT products_name_not_blank CHECK (btrim(name) <> '');
ALTER TABLE categories ADD CONSTRAINT categories_not_own_parent CHECK (parent_id <> id);

ALTER TABLE product_variants ADD CONSTRAINT product_variants_sku_format
  CHECK (sku = btrim(sku) AND sku <> '' AND length(sku) <= 64);
ALTER TABLE product_variants ADD CONSTRAINT product_variants_currency_format
  CHECK (currency ~ '^[A-Z]{3}$');
-- Money is never negative, and a sale price is below the regular price.
ALTER TABLE product_variants ADD CONSTRAINT product_variants_amounts_valid
  CHECK (
    price_amount >= 0
    AND (discount_price_amount IS NULL
         OR (discount_price_amount >= 0 AND discount_price_amount < price_amount))
    AND (compare_at_amount IS NULL OR compare_at_amount > price_amount)
    AND (cost_amount IS NULL OR cost_amount >= 0)
  );
ALTER TABLE product_variants ADD CONSTRAINT product_variants_measures_valid
  CHECK (
    (weight_grams IS NULL OR weight_grams >= 0)
    AND (length_mm IS NULL OR length_mm >= 0)
    AND (width_mm IS NULL OR width_mm >= 0)
    AND (height_mm IS NULL OR height_mm >= 0)
    AND (low_stock_threshold IS NULL OR low_stock_threshold >= 0)
  );
ALTER TABLE product_attributes ADD CONSTRAINT product_attributes_key_not_blank
  CHECK (btrim(key) <> '' AND btrim(value) <> '');

-- --- References stay inside one tenant --------------------------------------
-- Foreign keys are checked without Row-Level Security, so on their own they
-- would let a row point at another tenant's category, brand or product.
-- Usage: check_same_tenant('<referenced table>', '<referencing column>').
CREATE OR REPLACE FUNCTION app_private.check_same_tenant() RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
DECLARE
  referenced uuid := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  found boolean;
BEGIN
  IF referenced IS NULL THEN
    RETURN NEW;
  END IF;
  EXECUTE format('SELECT EXISTS (SELECT 1 FROM %I WHERE id = $1 AND tenant_id = $2)', TG_ARGV[0])
    INTO found USING referenced, NEW.tenant_id;
  IF NOT found THEN
    RAISE EXCEPTION '%.%: referenced row is not in the same tenant', TG_TABLE_NAME, TG_ARGV[1]
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION app_private.check_same_tenant() FROM PUBLIC;

CREATE TRIGGER categories_parent_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('categories', 'parent_id');
CREATE TRIGGER products_category_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, category_id ON products
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('categories', 'category_id');
CREATE TRIGGER products_brand_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, brand_id ON products
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('brands', 'brand_id');
CREATE TRIGGER product_variants_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON product_variants
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');
CREATE TRIGGER product_attributes_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON product_attributes
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');

-- --- Row-Level Security: full access, own tenant only -----------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories',
    'brands',
    'products',
    'product_variants',
    'product_attributes'
  ]
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
