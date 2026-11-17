-- CreateTable
CREATE TABLE "store_pages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "published" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "store_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_pages_tenant_id_slug_key" ON "store_pages"("tenant_id", "slug");

-- AddForeignKey
ALTER TABLE "store_pages" ADD CONSTRAINT "store_pages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: rules the schema language cannot express.
ALTER TABLE store_pages
  ADD CONSTRAINT store_pages_slug_valid CHECK (slug IN ('returns', 'delivery', 'privacy', 'terms')),
  ADD CONSTRAINT store_pages_text_valid CHECK (
    btrim(title) <> '' AND char_length(title) <= 100 AND char_length(body) <= 20000
  ),
  ADD CONSTRAINT store_pages_published_has_text CHECK (NOT published OR char_length(btrim(body)) >= 50);

ALTER TABLE store_pages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_pages FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON store_pages TO app_user;
