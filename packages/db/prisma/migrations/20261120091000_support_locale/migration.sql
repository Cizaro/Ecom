-- AlterTable
ALTER TABLE "support_conversations" ADD COLUMN     "locale" TEXT NOT NULL DEFAULT 'en';


-- Hand-written: only the shop's languages.
ALTER TABLE support_conversations
  ADD CONSTRAINT support_conversations_locale_valid CHECK (locale IN ('en', 'ar'));
