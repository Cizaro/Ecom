-- Milestone 6.4 (D113): a staff reply on Instagram or Facebook records how its
-- sending went. Messages stay a record otherwise: the app may change only
-- these three columns, never the text, the author or the time.
GRANT UPDATE (delivery_status, delivery_error, external_id) ON support_messages TO app_user;
