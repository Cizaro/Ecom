-- DropIndex
DROP INDEX "store_pages_tenant_id_slug_key";

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "store_pages" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en';

-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "languages" TEXT[] DEFAULT ARRAY['en']::TEXT[];

-- CreateTable
CREATE TABLE "product_translations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "short_description" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_translations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "category_translations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "locale" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "category_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_translations_tenant_id_locale_idx" ON "product_translations"("tenant_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "product_translations_product_id_locale_key" ON "product_translations"("product_id", "locale");

-- CreateIndex
CREATE INDEX "category_translations_tenant_id_idx" ON "category_translations"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "category_translations_category_id_locale_key" ON "category_translations"("category_id", "locale");

-- CreateIndex
CREATE UNIQUE INDEX "store_pages_tenant_id_slug_locale_key" ON "store_pages"("tenant_id", "slug", "locale");

-- AddForeignKey
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_translations" ADD CONSTRAINT "product_translations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "category_translations" ADD CONSTRAINT "category_translations_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Hand-written: rules the schema language cannot express.

-- Languages are English and Arabic for now; the store's default is always one
-- of its languages. Translations are for languages other than English (the
-- wording on the product itself).
ALTER TABLE stores
  ADD CONSTRAINT stores_languages_valid CHECK (
    languages IS NOT NULL
    AND cardinality(languages) BETWEEN 1 AND 2
    AND languages <@ ARRAY['en', 'ar']::text[]
    AND default_locale = ANY (languages)
  );
ALTER TABLE orders ADD CONSTRAINT orders_locale_valid CHECK (locale IN ('en', 'ar'));
ALTER TABLE store_pages ADD CONSTRAINT store_pages_locale_valid CHECK (locale IN ('en', 'ar'));

ALTER TABLE product_translations
  ADD CONSTRAINT product_translations_locale_valid CHECK (locale IN ('ar')),
  ADD CONSTRAINT product_translations_text_valid CHECK (
    char_length(name) <= 200 AND char_length(short_description) <= 500
    AND char_length(description) <= 20000
  );
ALTER TABLE category_translations
  ADD CONSTRAINT category_translations_locale_valid CHECK (locale IN ('ar')),
  ADD CONSTRAINT category_translations_text_valid CHECK (
    char_length(name) <= 100 AND char_length(description) <= 5000
  );

ALTER TABLE product_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_translations FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE category_translations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON category_translations FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON product_translations, category_translations TO app_user;

CREATE TRIGGER product_translations_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON product_translations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');
CREATE TRIGGER category_translations_category_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, category_id ON category_translations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('categories', 'category_id');
