-- CreateTable
CREATE TABLE "competitors" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT,
    "instagram" TEXT,
    "facebook" TEXT,
    "tiktok" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT NOT NULL DEFAULT '',
    "archived_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_observations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "competitor_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "price_amount" INTEGER,
    "currency" CHAR(3),
    "product_id" UUID,
    "source_url" TEXT,
    "observed_on" DATE NOT NULL,
    "collection_method" TEXT NOT NULL DEFAULT 'manual',
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_ideas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "idea" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "rationale" TEXT NOT NULL,
    "observation_ids" UUID[],
    "status" TEXT NOT NULL DEFAULT 'new',
    "origin" TEXT NOT NULL DEFAULT 'ai_generated',
    "model" TEXT NOT NULL DEFAULT '',
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_ideas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "competitors_tenant_id_name_key" ON "competitors"("tenant_id", "name");

-- CreateIndex
CREATE INDEX "research_observations_tenant_id_observed_on_idx" ON "research_observations"("tenant_id", "observed_on");

-- CreateIndex
CREATE INDEX "research_observations_competitor_id_idx" ON "research_observations"("competitor_id");

-- CreateIndex
CREATE INDEX "research_observations_product_id_idx" ON "research_observations"("product_id");

-- CreateIndex
CREATE INDEX "research_ideas_tenant_id_status_score_idx" ON "research_ideas"("tenant_id", "status", "score");

-- AddForeignKey
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_observations" ADD CONSTRAINT "research_observations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_observations" ADD CONSTRAINT "research_observations_competitor_id_fkey" FOREIGN KEY ("competitor_id") REFERENCES "competitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_observations" ADD CONSTRAINT "research_observations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_ideas" ADD CONSTRAINT "research_ideas_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: rules the schema language cannot express.
ALTER TABLE competitors
  ADD CONSTRAINT competitors_text_valid CHECK (
    btrim(name) <> '' AND char_length(name) <= 120 AND char_length(notes) <= 2000
    AND cardinality(tags) <= 20
  ),
  ADD CONSTRAINT competitors_links_valid CHECK (
    (website IS NULL OR (website ~ '^https?://' AND char_length(website) <= 500))
    AND (facebook IS NULL OR (facebook ~ '^https?://' AND char_length(facebook) <= 500))
    AND (instagram IS NULL OR instagram ~ '^[A-Za-z0-9._]{1,30}$')
    AND (tiktok IS NULL OR tiktok ~ '^[A-Za-z0-9._]{1,30}$')
  );
ALTER TABLE research_observations
  ADD CONSTRAINT research_observations_kind_valid CHECK (
    kind IN ('product', 'price', 'promotion', 'post', 'hook', 'hashtag', 'review', 'other')
  ),
  ADD CONSTRAINT research_observations_text_valid CHECK (
    btrim(title) <> '' AND char_length(title) <= 200 AND char_length(detail) <= 2000
  ),
  ADD CONSTRAINT research_observations_price_valid CHECK (
    (price_amount IS NULL AND currency IS NULL)
    OR (price_amount >= 0 AND currency ~ '^[A-Z]{3}$')
  ),
  ADD CONSTRAINT research_observations_source_valid CHECK (
    source_url IS NULL OR (source_url ~ '^https?://' AND char_length(source_url) <= 1000)
  ),
  ADD CONSTRAINT research_observations_method_valid CHECK (collection_method IN ('manual'));
ALTER TABLE research_ideas
  ADD CONSTRAINT research_ideas_score_valid CHECK (score BETWEEN 0 AND 100),
  ADD CONSTRAINT research_ideas_status_valid CHECK (status IN ('new', 'accepted', 'dismissed')),
  ADD CONSTRAINT research_ideas_origin_valid CHECK (origin IN ('ai_generated')),
  ADD CONSTRAINT research_ideas_cites CHECK (cardinality(observation_ids) BETWEEN 1 AND 20),
  ADD CONSTRAINT research_ideas_text_valid CHECK (
    btrim(title) <> '' AND char_length(title) <= 200 AND char_length(idea) <= 2000
    AND char_length(rationale) <= 2000
  );

ALTER TABLE competitors ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON competitors FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE research_observations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON research_observations FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE research_ideas ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON research_ideas FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON competitors TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON research_observations TO app_user;
GRANT SELECT, INSERT, UPDATE ON research_ideas TO app_user;

CREATE TRIGGER research_observations_competitor_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, competitor_id ON research_observations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('competitors', 'competitor_id');
CREATE TRIGGER research_observations_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON research_observations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');
