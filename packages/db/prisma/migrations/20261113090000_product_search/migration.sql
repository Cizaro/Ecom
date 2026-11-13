-- AlterTable
ALTER TABLE "products" ADD COLUMN     "search_vector" tsvector;

-- CreateIndex
CREATE INDEX "products_search_vector_idx" ON "products" USING GIN ("search_vector");


-- ---------------------------------------------------------------------------
-- Hand-written from here.
-- ---------------------------------------------------------------------------

-- The words a shopper can search for, weighted: name first, then the short
-- description, then material and audience tags, then the long description.
-- The 'simple' configuration splits text into lowercase words without
-- language-specific stemming, so it behaves the same for every language a
-- store writes in (decision D42).
CREATE OR REPLACE FUNCTION app_private.products_search_vector() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('simple', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(NEW.short_description, '')), 'B') ||
    setweight(to_tsvector('simple',
      coalesce(NEW.material, '') || ' ' || array_to_string(NEW.audience_tags, ' ')), 'C') ||
    setweight(to_tsvector('simple', coalesce(NEW.description, '')), 'D');
  RETURN NEW;
END
$$;

CREATE TRIGGER products_search_vector
  BEFORE INSERT OR UPDATE OF name, short_description, description, material, audience_tags
  ON products
  FOR EACH ROW EXECUTE FUNCTION app_private.products_search_vector();

-- Fill the column for products that already exist.
UPDATE products SET name = name;

-- Storefront lists read only published products, newest first.
CREATE INDEX products_published_idx ON products (tenant_id, created_at DESC)
  WHERE status = 'active';
