-- The helper schema was named "app". PostgreSQL's default search_path starts
-- with "$user", so when the migrating role is also called "app" (as in local
-- development and CI), unqualified CREATE TABLE statements landed in that
-- schema instead of public. The authentication tables were affected.
--
-- 1. Move any table that ended up in the helper schema back to public.
-- 2. Rename the helper schema to a name no login role will ever have.
--
-- Policies and triggers reference the helper functions by identity, not by
-- name, so they keep working. The settings app.tenant_id and app.user_id are
-- configuration parameters, unrelated to the schema name, and do not change.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app'
  LOOP
    EXECUTE format('ALTER TABLE app.%I SET SCHEMA public', t);
  END LOOP;
END
$$;

ALTER SCHEMA app RENAME TO app_private;
