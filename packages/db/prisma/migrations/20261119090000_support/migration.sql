-- AlterTable
ALTER TABLE "notification_settings" ADD COLUMN     "support_emails" TEXT[];

-- CreateTable
CREATE TABLE "support_conversations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "order_id" UUID,
    "assigned_user_id" UUID,
    "access_key_hash" TEXT NOT NULL,
    "last_message_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_messages" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_user_id" UUID,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_notes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "author_user_id" UUID,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_access_key_hash_key" ON "support_conversations"("access_key_hash");

-- CreateIndex
CREATE INDEX "support_conversations_tenant_id_status_last_message_at_idx" ON "support_conversations"("tenant_id", "status", "last_message_at");

-- CreateIndex
CREATE INDEX "support_conversations_customer_id_last_message_at_idx" ON "support_conversations"("customer_id", "last_message_at");

-- CreateIndex
CREATE INDEX "support_messages_conversation_id_created_at_idx" ON "support_messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "support_messages_tenant_id_idx" ON "support_messages"("tenant_id");

-- CreateIndex
CREATE INDEX "customer_notes_customer_id_created_at_idx" ON "customer_notes"("customer_id", "created_at");

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written: rules the schema language cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE support_conversations
  ADD CONSTRAINT support_conversations_status_valid CHECK (status IN ('open', 'waiting', 'closed')),
  ADD CONSTRAINT support_conversations_text_valid CHECK (
    email = lower(email) AND char_length(email) <= 254
    AND btrim(name) <> '' AND char_length(name) <= 100
    AND btrim(subject) <> '' AND char_length(subject) <= 150
  ),
  ADD CONSTRAINT support_conversations_key_format CHECK (access_key_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE support_messages
  ADD CONSTRAINT support_messages_author_valid CHECK (
    (author_type = 'customer' AND author_user_id IS NULL)
    OR (author_type IN ('staff', 'note') AND author_user_id IS NOT NULL)
  ),
  ADD CONSTRAINT support_messages_text_valid CHECK (
    btrim(body) <> '' AND char_length(body) <= 5000
    AND btrim(author_name) <> '' AND char_length(author_name) <= 100
  );

ALTER TABLE customer_notes
  ADD CONSTRAINT customer_notes_text_valid CHECK (
    btrim(body) <> '' AND char_length(body) <= 2000 AND char_length(author_name) <= 100
  );

ALTER TABLE notification_settings
  ADD CONSTRAINT notification_settings_support_valid CHECK (
    coalesce(cardinality(support_emails), 0) <= 5
  );

CREATE TRIGGER support_conversations_customer_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON support_conversations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');
CREATE TRIGGER support_conversations_order_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, order_id ON support_conversations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('orders', 'order_id');
CREATE TRIGGER support_messages_conversation_same_tenant
  BEFORE INSERT ON support_messages
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('support_conversations', 'conversation_id');
CREATE TRIGGER customer_notes_customer_same_tenant
  BEFORE INSERT ON customer_notes
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');

-- Row-Level Security: own tenant only.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_conversations', 'support_messages', 'customer_notes']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
  END LOOP;
END
$$;
GRANT SELECT, INSERT, UPDATE ON support_conversations TO app_user;
-- Messages and notes are a record: added and read, never changed or deleted.
GRANT SELECT, INSERT ON support_messages, customer_notes TO app_user;
