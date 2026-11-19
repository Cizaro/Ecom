-- AlterTable
ALTER TABLE "support_conversations" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'web',
ADD COLUMN     "external_reply_to_id" TEXT,
ADD COLUMN     "external_thread_key" TEXT,
ADD COLUMN     "external_user_id" TEXT,
ADD COLUMN     "external_username" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'message',
ADD COLUMN     "social_connection_id" UUID;

-- AlterTable
ALTER TABLE "support_messages" ADD COLUMN     "delivery_error" TEXT,
ADD COLUMN     "delivery_status" TEXT,
ADD COLUMN     "external_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "support_conversations_tenant_id_external_thread_key_key" ON "support_conversations"("tenant_id", "external_thread_key");

-- CreateIndex
CREATE UNIQUE INDEX "support_messages_tenant_id_external_id_key" ON "support_messages"("tenant_id", "external_id");

-- AddForeignKey
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_social_connection_id_fkey" FOREIGN KEY ("social_connection_id") REFERENCES "social_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: rules the schema language cannot express.
ALTER TABLE support_conversations
  ADD CONSTRAINT support_conversations_channel_valid CHECK (channel IN ('web', 'instagram', 'facebook')),
  ADD CONSTRAINT support_conversations_kind_valid CHECK (kind IN ('message', 'comment')),
  ADD CONSTRAINT support_conversations_social_valid CHECK (
    (channel = 'web' AND kind = 'message' AND external_thread_key IS NULL
      AND external_user_id IS NULL AND external_username IS NULL AND external_reply_to_id IS NULL)
    OR (channel IN ('instagram', 'facebook') AND external_thread_key IS NOT NULL
      AND char_length(external_thread_key) <= 300
      AND (external_user_id IS NULL OR external_user_id ~ '^[0-9]{1,40}$')
      AND (external_username IS NULL OR char_length(external_username) <= 100)
      AND (external_reply_to_id IS NULL OR external_reply_to_id ~ '^[0-9_]{1,80}$'))
  );
ALTER TABLE support_messages
  ADD CONSTRAINT support_messages_external_valid CHECK (
    external_id IS NULL OR (btrim(external_id) <> '' AND char_length(external_id) <= 300)
  ),
  ADD CONSTRAINT support_messages_delivery_valid CHECK (
    (delivery_status IS NULL AND delivery_error IS NULL)
    OR (delivery_status IN ('sending', 'sent', 'failed') AND author_type = 'staff'
      AND (delivery_error IS NULL OR char_length(delivery_error) <= 500))
  );

CREATE TRIGGER support_conversations_social_connection_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, social_connection_id ON support_conversations
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('social_connections', 'social_connection_id');
