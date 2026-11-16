-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('active', 'disabled');

-- CreateEnum
CREATE TYPE "customer_token_purpose" AS ENUM ('verify_email', 'reset_password');

-- AlterTable
ALTER TABLE "carts" ADD COLUMN     "customer_id" UUID;

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "phone" TEXT,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMPTZ(3),
    "status" "customer_status" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_tokens" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "purpose" "customer_token_purpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "region" TEXT,
    "postal_code" TEXT,
    "country" CHAR(2) NOT NULL,
    "is_default_shipping" BOOLEAN NOT NULL DEFAULT false,
    "is_default_billing" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenant_id_created_at_idx" ON "customers"("tenant_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_email_key" ON "customers"("tenant_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "customer_sessions_token_hash_key" ON "customer_sessions"("token_hash");

-- CreateIndex
CREATE INDEX "customer_sessions_customer_id_idx" ON "customer_sessions"("customer_id");

-- CreateIndex
CREATE INDEX "customer_sessions_expires_at_idx" ON "customer_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "customer_tokens_token_hash_key" ON "customer_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "customer_tokens_customer_id_purpose_idx" ON "customer_tokens"("customer_id", "purpose");

-- CreateIndex
CREATE INDEX "customer_tokens_expires_at_idx" ON "customer_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "addresses_customer_id_idx" ON "addresses"("customer_id");

-- CreateIndex
CREATE INDEX "addresses_tenant_id_idx" ON "addresses"("tenant_id");

-- CreateIndex
CREATE INDEX "carts_customer_id_idx" ON "carts"("customer_id");

-- AddForeignKey
ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_sessions" ADD CONSTRAINT "customer_sessions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tokens" ADD CONSTRAINT "customer_tokens_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_tokens" ADD CONSTRAINT "customer_tokens_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written from here: rules Prisma cannot express.
-- ---------------------------------------------------------------------------

ALTER TABLE customers
  ADD CONSTRAINT customers_email_lowercase CHECK (email = lower(email)),
  ADD CONSTRAINT customers_email_shape CHECK (email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
  ADD CONSTRAINT customers_email_length CHECK (char_length(email) <= 254),
  ADD CONSTRAINT customers_name_length CHECK (char_length(name) <= 200);

ALTER TABLE customer_sessions
  ADD CONSTRAINT customer_sessions_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$');
ALTER TABLE customer_tokens
  ADD CONSTRAINT customer_tokens_token_hash_format CHECK (token_hash ~ '^[0-9a-f]{64}$');

ALTER TABLE addresses
  ADD CONSTRAINT addresses_country_format CHECK (country ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT addresses_required_text CHECK (
    btrim(full_name) <> '' AND btrim(line1) <> '' AND btrim(city) <> ''
  );

-- A customer has at most one default shipping and one default billing address.
CREATE UNIQUE INDEX addresses_one_default_shipping
  ON addresses (customer_id) WHERE is_default_shipping;
CREATE UNIQUE INDEX addresses_one_default_billing
  ON addresses (customer_id) WHERE is_default_billing;

-- References stay inside one tenant (see the catalog migration).
CREATE TRIGGER customer_sessions_customer_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON customer_sessions
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');
CREATE TRIGGER customer_tokens_customer_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON customer_tokens
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');
CREATE TRIGGER addresses_customer_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON addresses
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');
CREATE TRIGGER carts_customer_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, customer_id ON carts
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('customers', 'customer_id');

-- Row-Level Security: own tenant only. Which customer inside the tenant a
-- request may act for is decided by the customer session, in the services.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'customer_sessions', 'customer_tokens', 'addresses']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I FOR ALL
         USING (tenant_id = app_private.current_tenant_id())
         WITH CHECK (tenant_id = app_private.current_tenant_id())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO app_user', t);
  END LOOP;
END
$$;
