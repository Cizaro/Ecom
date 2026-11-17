-- CreateTable
CREATE TABLE "product_suggestions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "locale" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposal" JSONB NOT NULL,
    "applied_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ai_event_id" UUID,
    "created_by_user_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_suggestions_tenant_id_product_id_status_idx" ON "product_suggestions"("tenant_id", "product_id", "status");

-- AddForeignKey
ALTER TABLE "product_suggestions" ADD CONSTRAINT "product_suggestions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_suggestions" ADD CONSTRAINT "product_suggestions_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_suggestions" ADD CONSTRAINT "product_suggestions_ai_event_id_fkey" FOREIGN KEY ("ai_event_id") REFERENCES "ai_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;



-- Hand-written: rules the schema language cannot express.
ALTER TABLE product_suggestions
  ADD CONSTRAINT product_suggestions_kind_valid CHECK (kind IN ('copy', 'translation')),
  ADD CONSTRAINT product_suggestions_status_valid CHECK (
    status IN ('pending', 'applied', 'dismissed', 'replaced')
  ),
  ADD CONSTRAINT product_suggestions_decided CHECK (
    (status = 'pending') = (decided_at IS NULL)
  );

-- At most one waiting draft of each kind and language per product.
CREATE UNIQUE INDEX product_suggestions_one_pending
  ON product_suggestions (product_id, kind, locale) WHERE status = 'pending';

-- The draft, and the AI run it came from, belong to the same store as the product.
CREATE TRIGGER product_suggestions_product_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, product_id ON product_suggestions
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('products', 'product_id');
CREATE TRIGGER product_suggestions_event_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, ai_event_id ON product_suggestions
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('ai_events', 'ai_event_id');

ALTER TABLE product_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON product_suggestions FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

-- Drafts are decided (status changes), never deleted by the app.
GRANT SELECT, INSERT, UPDATE ON product_suggestions TO app_user;
