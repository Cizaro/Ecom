-- Tables, enums and indexes generated from schema.prisma.
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "tenant_status" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "user_status" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "membership_status" AS ENUM ('invited', 'active', 'revoked');

-- CreateEnum
CREATE TYPE "subject_type" AS ENUM ('user', 'customer');

-- CreateEnum
CREATE TYPE "consent_purpose" AS ENUM ('marketing_email', 'marketing_sms', 'cookies_analytics', 'cookies_marketing', 'ugc_reuse');

-- CreateEnum
CREATE TYPE "job_status" AS ENUM ('queued', 'running', 'succeeded', 'failed');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "tenant_status" NOT NULL DEFAULT 'active',
    "ai_monthly_budget_amount" INTEGER,
    "ai_budget_currency" CHAR(3),
    "automation_paused" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "default_locale" TEXT NOT NULL DEFAULT 'en',
    "default_currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "branding" JSONB NOT NULL DEFAULT '{}',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "password_hash" TEXT,
    "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "status" "user_status" NOT NULL DEFAULT 'active',
    "deleted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "is_system" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_permissions" (
    "role_id" UUID NOT NULL,
    "permission_id" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("role_id","permission_id")
);

-- CreateTable
CREATE TABLE "user_tenant_memberships" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "store_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "membership_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "user_tenant_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "actor_type" TEXT NOT NULL,
    "actor_user_id" UUID,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ip" TEXT,
    "request_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_type" "subject_type" NOT NULL,
    "subject_id" UUID NOT NULL,
    "purpose" "consent_purpose" NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "policy_version" TEXT,
    "recorded_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subject_type" "subject_type" NOT NULL,
    "subject_id" UUID NOT NULL,
    "channel" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "processed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "jobs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID,
    "queue" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "job_status" NOT NULL DEFAULT 'queued',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "error" TEXT,
    "idempotency_key" TEXT,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

-- CreateIndex
CREATE INDEX "stores_tenant_id_created_at_idx" ON "stores"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "stores_tenant_id_slug_key" ON "stores"("tenant_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "roles_tenant_id_key_key" ON "roles"("tenant_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "permissions"("key");

-- CreateIndex
CREATE INDEX "role_permissions_permission_id_idx" ON "role_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "user_tenant_memberships_tenant_id_status_idx" ON "user_tenant_memberships"("tenant_id", "status");

-- CreateIndex
CREATE INDEX "user_tenant_memberships_role_id_idx" ON "user_tenant_memberships"("role_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_tenant_memberships_user_id_tenant_id_key" ON "user_tenant_memberships"("user_id", "tenant_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_entity_type_entity_id_idx" ON "audit_logs"("tenant_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_actor_user_id_created_at_idx" ON "audit_logs"("tenant_id", "actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "consent_records_tenant_id_subject_type_subject_id_purpose_r_idx" ON "consent_records"("tenant_id", "subject_type", "subject_id", "purpose", "recorded_at");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_tenant_id_subject_type_subject_id__key" ON "notification_preferences"("tenant_id", "subject_type", "subject_id", "channel", "category");

-- CreateIndex
CREATE UNIQUE INDEX "feature_flags_tenant_id_key_key" ON "feature_flags"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_keys_tenant_id_key_key" ON "idempotency_keys"("tenant_id", "key");

-- CreateIndex
CREATE INDEX "outbox_events_processed_at_created_at_idx" ON "outbox_events"("processed_at", "created_at");

-- CreateIndex
CREATE INDEX "outbox_events_tenant_id_created_at_idx" ON "outbox_events"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "jobs_tenant_id_status_created_at_idx" ON "jobs"("tenant_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "jobs_tenant_id_idempotency_key_key" ON "jobs"("tenant_id", "idempotency_key");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roles" ADD CONSTRAINT "roles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "role_permissions" ADD CONSTRAINT "role_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenant_memberships" ADD CONSTRAINT "user_tenant_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenant_memberships" ADD CONSTRAINT "user_tenant_memberships_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_tenant_memberships" ADD CONSTRAINT "user_tenant_memberships_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feature_flags" ADD CONSTRAINT "feature_flags_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ===========================================================================
-- Hand-written security SQL (not generated by Prisma). See ARCHITECTURE.md
-- section 4 and docs/DATA_MODEL.md.
-- ===========================================================================

-- --- Runtime role ----------------------------------------------------------
-- The application connects as app_user, which owns nothing and cannot bypass
-- Row-Level Security. The role is created without a password; its password is
-- set from DATABASE_URL by packages/db/scripts/sync-app-role.ts after migrating,
-- so no credential ever appears in a migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;

-- --- Request context -------------------------------------------------------
-- Set per transaction with set_config('app.tenant_id', ..., true). Unset or
-- empty yields NULL, which matches no rows.
CREATE SCHEMA IF NOT EXISTS app;

CREATE OR REPLACE FUNCTION app.current_tenant_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.tenant_id', true), '')::uuid $$;

CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
  LANGUAGE sql STABLE
  AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

GRANT USAGE ON SCHEMA public TO app_user;
GRANT USAGE ON SCHEMA app TO app_user;
GRANT EXECUTE ON FUNCTION app.current_tenant_id(), app.current_user_id() TO app_user;

-- --- Constraints Prisma cannot express --------------------------------------
ALTER TABLE users ADD CONSTRAINT users_email_lowercase CHECK (email = lower(email));
CREATE UNIQUE INDEX roles_system_key_unique ON roles (key) WHERE tenant_id IS NULL;
CREATE UNIQUE INDEX feature_flags_global_key_unique ON feature_flags (key) WHERE tenant_id IS NULL;
ALTER TABLE roles ADD CONSTRAINT roles_system_has_no_tenant
  CHECK (NOT is_system OR tenant_id IS NULL);

-- --- Plain tenant-owned tables: full access, own tenant only ----------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'stores',
    'user_tenant_memberships',
    'consent_records',
    'notification_preferences',
    'idempotency_keys',
    'outbox_events',
    'jobs'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app.current_tenant_id())
         WITH CHECK (tenant_id = app.current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END
$$;

-- A signed-in user can also see their own memberships in other tenants
-- (needed to choose which tenant to work in).
CREATE POLICY membership_self_select ON user_tenant_memberships FOR SELECT
  USING (user_id = app.current_user_id());

-- --- tenants: a tenant sees and edits only its own row ---------------------
-- Creating and deleting tenants is a platform operation (admin connection).
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenants FOR ALL
  USING (id = app.current_tenant_id())
  WITH CHECK (id = app.current_tenant_id());
GRANT SELECT, UPDATE ON tenants TO app_user;

-- --- users -----------------------------------------------------------------
-- Visible: yourself, and members of the current tenant. Editable: yourself,
-- name only. password_hash and is_platform_admin are never granted to the
-- runtime role; authentication uses the admin connection.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
CREATE POLICY users_select ON users FOR SELECT
  USING (
    id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM user_tenant_memberships m
      WHERE m.user_id = users.id AND m.tenant_id = app.current_tenant_id()
    )
  );
CREATE POLICY users_update_self ON users FOR UPDATE
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id());
GRANT SELECT (id, email, name, mfa_enabled, status, deleted_at, created_at, updated_at)
  ON users TO app_user;
GRANT UPDATE (name, updated_at) ON users TO app_user;

-- --- roles: system roles are readable by all, never writable ---------------
ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_select ON roles FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant_id());
CREATE POLICY roles_insert ON roles FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id() AND NOT is_system);
CREATE POLICY roles_update ON roles FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id() AND NOT is_system);
CREATE POLICY roles_delete ON roles FOR DELETE
  USING (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON roles TO app_user;

-- --- role_permissions: follow the role they belong to ----------------------
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_select ON role_permissions FOR SELECT
  USING (EXISTS (SELECT 1 FROM roles r WHERE r.id = role_id));
CREATE POLICY role_permissions_insert ON role_permissions FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_id AND r.tenant_id = app.current_tenant_id()
  ));
CREATE POLICY role_permissions_delete ON role_permissions FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM roles r WHERE r.id = role_id AND r.tenant_id = app.current_tenant_id()
  ));
GRANT SELECT, INSERT, DELETE ON role_permissions TO app_user;

-- --- permissions: global catalogue, read-only ------------------------------
GRANT SELECT ON permissions TO app_user;

-- --- feature_flags: global defaults readable, tenant overrides writable ----
ALTER TABLE feature_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY feature_flags_select ON feature_flags FOR SELECT
  USING (tenant_id IS NULL OR tenant_id = app.current_tenant_id());
CREATE POLICY feature_flags_insert ON feature_flags FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY feature_flags_update ON feature_flags FOR UPDATE
  USING (tenant_id = app.current_tenant_id())
  WITH CHECK (tenant_id = app.current_tenant_id());
CREATE POLICY feature_flags_delete ON feature_flags FOR DELETE
  USING (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON feature_flags TO app_user;

-- --- audit_logs: append-only for everyone ----------------------------------
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_logs_select ON audit_logs FOR SELECT
  USING (tenant_id = app.current_tenant_id());
CREATE POLICY audit_logs_insert ON audit_logs FOR INSERT
  WITH CHECK (tenant_id = app.current_tenant_id());
GRANT SELECT, INSERT ON audit_logs TO app_user;

CREATE OR REPLACE FUNCTION app.reject_modification() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  RAISE EXCEPTION '% is append-only: % is not allowed', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'restrict_violation';
END
$$;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.reject_modification();
CREATE TRIGGER audit_logs_no_truncate
  BEFORE TRUNCATE ON audit_logs
  FOR EACH STATEMENT EXECUTE FUNCTION app.reject_modification();
