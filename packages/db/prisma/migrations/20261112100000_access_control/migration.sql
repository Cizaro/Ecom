-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "active_tenant_id" UUID;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "require_staff_two_factor" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "store_domains" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "hostname" TEXT NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "store_domains_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "store_domains_hostname_key" ON "store_domains"("hostname");

-- CreateIndex
CREATE INDEX "store_domains_tenant_id_idx" ON "store_domains"("tenant_id");

-- CreateIndex
CREATE INDEX "store_domains_store_id_idx" ON "store_domains"("store_id");

-- CreateIndex
CREATE INDEX "sessions_active_tenant_id_idx" ON "sessions"("active_tenant_id");

-- AddForeignKey
ALTER TABLE "store_domains" ADD CONSTRAINT "store_domains_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "store_domains" ADD CONSTRAINT "store_domains_store_id_fkey" FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_active_tenant_id_fkey" FOREIGN KEY ("active_tenant_id") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- --- Constraints Prisma cannot express --------------------------------------
-- Host names are stored in one canonical form so lookups are exact matches.
ALTER TABLE store_domains ADD CONSTRAINT store_domains_hostname_canonical
  CHECK (hostname = lower(hostname) AND hostname !~ '[:/\s]' AND hostname !~ '\.$' AND length(hostname) BETWEEN 1 AND 253);

-- A domain's store must belong to the same tenant as the domain.
CREATE OR REPLACE FUNCTION app_private.check_store_domain_tenant() RETURNS trigger
  LANGUAGE plpgsql
  AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM stores WHERE id = NEW.store_id AND tenant_id = NEW.tenant_id) THEN
    RAISE EXCEPTION 'store_domains: store % does not belong to tenant %', NEW.store_id, NEW.tenant_id
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER store_domains_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, store_id ON store_domains
  FOR EACH ROW EXECUTE FUNCTION app_private.check_store_domain_tenant();

-- --- Row-Level Security -----------------------------------------------------
ALTER TABLE store_domains ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store_domains FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON store_domains TO app_user;

-- --- Storefront host resolution ---------------------------------------------
-- The storefront must find its tenant before any tenant context exists. This
-- function is the only cross-tenant read the runtime role can make: it takes a
-- host name and returns at most one (tenant, store) pair for an active tenant,
-- and nothing else. SECURITY DEFINER runs it as the table owner, so it is
-- pinned to a fixed search_path.
CREATE OR REPLACE FUNCTION app_private.resolve_store_host(host text)
  RETURNS TABLE (tenant_id uuid, store_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT d.tenant_id, d.store_id
    FROM store_domains d
    JOIN tenants t ON t.id = d.tenant_id
    WHERE d.hostname = lower(host) AND t.status = 'active'
    LIMIT 1
  $$;

REVOKE ALL ON FUNCTION app_private.resolve_store_host(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.resolve_store_host(text) TO app_user;
