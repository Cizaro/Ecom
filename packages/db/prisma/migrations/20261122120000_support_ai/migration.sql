-- AlterTable
ALTER TABLE "support_conversations" ADD COLUMN     "ai_category" TEXT,
ADD COLUMN     "ai_check_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "ai_checked_message_id" UUID,
ADD COLUMN     "ai_summary" TEXT,
ADD COLUMN     "ai_urgency" TEXT;

-- CreateTable
CREATE TABLE "support_reply_drafts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "body" TEXT NOT NULL,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "handover" BOOLEAN NOT NULL DEFAULT false,
    "edited" BOOLEAN NOT NULL DEFAULT false,
    "ai_event_id" UUID,
    "created_by_user_id" UUID,
    "decided_by_user_id" UUID,
    "decided_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "support_reply_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_reply_drafts_tenant_id_conversation_id_status_idx" ON "support_reply_drafts"("tenant_id", "conversation_id", "status");

-- AddForeignKey
ALTER TABLE "support_reply_drafts" ADD CONSTRAINT "support_reply_drafts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_reply_drafts" ADD CONSTRAINT "support_reply_drafts_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "support_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Hand-written: rules the schema language cannot express.
ALTER TABLE support_conversations
  ADD CONSTRAINT support_conversations_ai_category_valid CHECK (ai_category IS NULL OR ai_category IN (
    'question', 'order_status', 'other', 'refund', 'payment_problem', 'legal', 'threat', 'privacy',
    'complaint', 'account', 'spam', 'abuse'
  )),
  ADD CONSTRAINT support_conversations_ai_urgency_valid CHECK (ai_urgency IS NULL OR ai_urgency IN ('normal', 'high')),
  ADD CONSTRAINT support_conversations_ai_summary_valid CHECK (ai_summary IS NULL OR char_length(ai_summary) <= 200),
  ADD CONSTRAINT support_conversations_ai_attempts_valid CHECK (ai_check_attempts BETWEEN 0 AND 10);

ALTER TABLE support_reply_drafts
  ADD CONSTRAINT support_reply_drafts_status_valid CHECK (status IN ('pending', 'sent', 'dismissed', 'replaced')),
  ADD CONSTRAINT support_reply_drafts_body_valid CHECK (btrim(body) <> '' AND char_length(body) <= 5000);

ALTER TABLE support_reply_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON support_reply_drafts FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE ON support_reply_drafts TO app_user;

CREATE TRIGGER support_reply_drafts_conversation_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, conversation_id ON support_reply_drafts
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('support_conversations', 'conversation_id');
