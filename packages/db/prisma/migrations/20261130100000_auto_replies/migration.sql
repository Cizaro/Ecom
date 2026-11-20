-- Milestone 6.4 follow-up (D115): automatic replies. A reply the AI sent on
-- its own is a message by "ai" with no staff member; it is recorded and, on
-- Instagram or Facebook, has a delivery status like a staff reply.
ALTER TABLE support_messages DROP CONSTRAINT support_messages_author_valid;
ALTER TABLE support_messages ADD CONSTRAINT support_messages_author_valid CHECK (
  (author_type IN ('customer', 'ai') AND author_user_id IS NULL)
  OR (author_type IN ('staff', 'note') AND author_user_id IS NOT NULL)
);
ALTER TABLE support_messages DROP CONSTRAINT support_messages_delivery_valid;
ALTER TABLE support_messages ADD CONSTRAINT support_messages_delivery_valid CHECK (
  (delivery_status IS NULL AND delivery_error IS NULL)
  OR (delivery_status IN ('sending', 'sent', 'failed') AND author_type IN ('staff', 'ai')
    AND (delivery_error IS NULL OR char_length(delivery_error) <= 500))
);
