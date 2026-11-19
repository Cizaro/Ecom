-- CreateTable
CREATE TABLE "social_connections" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "page_id" TEXT NOT NULL,
    "page_name" TEXT NOT NULL,
    "instagram_account_id" TEXT,
    "instagram_username" TEXT,
    "access_token_encrypted" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "connected_by_user_id" UUID,
    "connected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_webhook_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "social_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_webhook_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "external_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurred_at" TIMESTAMPTZ(3),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ(3),

    CONSTRAINT "social_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_tenant_id_provider_key" ON "social_connections"("tenant_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "social_connections_provider_page_id_key" ON "social_connections"("provider", "page_id");

-- CreateIndex
CREATE INDEX "social_webhook_events_tenant_id_processed_at_idx" ON "social_webhook_events"("tenant_id", "processed_at");

-- CreateIndex
CREATE UNIQUE INDEX "social_webhook_events_tenant_id_external_key_key" ON "social_webhook_events"("tenant_id", "external_key");

-- AddForeignKey
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_webhook_events" ADD CONSTRAINT "social_webhook_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_webhook_events" ADD CONSTRAINT "social_webhook_events_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "social_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written: rules the schema language cannot express.
ALTER TABLE social_connections
  ADD CONSTRAINT social_connections_provider_valid CHECK (provider IN ('meta')),
  ADD CONSTRAINT social_connections_status_valid CHECK (status IN ('active', 'needs_reconnect')),
  ADD CONSTRAINT social_connections_ids_valid CHECK (
    page_id ~ '^[0-9]{1,30}$'
    AND (instagram_account_id IS NULL OR instagram_account_id ~ '^[0-9]{1,30}$')
    AND (instagram_username IS NULL OR instagram_username ~ '^[A-Za-z0-9._]{1,30}$')
  ),
  ADD CONSTRAINT social_connections_text_valid CHECK (
    btrim(page_name) <> '' AND char_length(page_name) <= 200
    AND access_token_encrypted LIKE 'v1:%' AND cardinality(scopes) <= 50
  );
-- An Instagram account belongs to one store at a time.
CREATE UNIQUE INDEX social_connections_instagram_key
  ON social_connections (provider, instagram_account_id) WHERE instagram_account_id IS NOT NULL;

ALTER TABLE social_webhook_events
  ADD CONSTRAINT social_webhook_events_channel_valid CHECK (channel IN ('facebook', 'instagram')),
  ADD CONSTRAINT social_webhook_events_kind_valid CHECK (kind IN ('message', 'comment', 'other')),
  ADD CONSTRAINT social_webhook_events_key_valid CHECK (
    btrim(external_key) <> '' AND char_length(external_key) <= 300
  );

ALTER TABLE social_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON social_connections FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE social_webhook_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON social_webhook_events FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

GRANT SELECT, INSERT, UPDATE, DELETE ON social_connections TO app_user;
GRANT SELECT, INSERT, UPDATE ON social_webhook_events TO app_user;

CREATE TRIGGER social_webhook_events_connection_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, connection_id ON social_webhook_events
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('social_connections', 'connection_id');
