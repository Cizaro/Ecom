-- AlterTable
ALTER TABLE "outbox_events" ADD COLUMN     "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dedupe_key" TEXT,
ADD COLUMN     "locked_until" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "notification_settings" (
    "tenant_id" UUID NOT NULL,
    "order_emails" TEXT[],
    "stock_emails" TEXT[],
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_available_at_idx" ON "outbox_events"("processed_at", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_tenant_id_dedupe_key_key" ON "outbox_events"("tenant_id", "dedupe_key");

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules the schema language cannot express.
-- ---------------------------------------------------------------------------

-- At most five addresses per list, each a plausible email address.
ALTER TABLE notification_settings
  ADD CONSTRAINT notification_settings_lists_valid CHECK (
    coalesce(cardinality(order_emails), 0) <= 5
    AND coalesce(cardinality(stock_emails), 0) <= 5
    AND coalesce(array_to_string(order_emails, ' '), '') !~ '[^ ]{255,}'
    AND coalesce(array_to_string(stock_emails, ' '), '') !~ '[^ ]{255,}'
  );

ALTER TABLE outbox_events
  ADD CONSTRAINT outbox_events_dedupe_key_length CHECK (
    dedupe_key IS NULL OR char_length(dedupe_key) <= 300
  );

-- Row-Level Security: own tenant only.
ALTER TABLE notification_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON notification_settings FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON notification_settings TO app_user;
