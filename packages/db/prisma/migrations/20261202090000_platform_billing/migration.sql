-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "paid_until" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "platform_plans" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "price_amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "product_limit" INTEGER,
    "staff_limit" INTEGER,
    "ai_monthly_budget_amount" INTEGER,
    "is_public" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "plan_key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "period_start" TIMESTAMPTZ(3) NOT NULL,
    "period_end" TIMESTAMPTZ(3) NOT NULL,
    "due_at" TIMESTAMPTZ(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "paid_at" TIMESTAMPTZ(3),
    "method" TEXT,
    "reference" TEXT,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "payment_instructions" TEXT NOT NULL DEFAULT '',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_plans_key_key" ON "platform_plans"("key");

-- CreateIndex
CREATE UNIQUE INDEX "platform_invoices_number_key" ON "platform_invoices"("number");

-- CreateIndex
CREATE INDEX "platform_invoices_tenant_id_created_at_idx" ON "platform_invoices"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "platform_invoices" ADD CONSTRAINT "platform_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Hand-written (D122): rules the schema language cannot express.
ALTER TABLE platform_plans
  ADD CONSTRAINT platform_plans_key_valid CHECK (key ~ '^[a-z][a-z0-9_]{0,29}$' AND key <> 'trial'),
  ADD CONSTRAINT platform_plans_text_valid CHECK (
    btrim(name) <> '' AND char_length(name) <= 60 AND char_length(description) <= 500
  ),
  ADD CONSTRAINT platform_plans_amounts_valid CHECK (
    price_amount >= 0
    AND (product_limit IS NULL OR product_limit >= 0)
    AND (staff_limit IS NULL OR staff_limit >= 1)
    AND (ai_monthly_budget_amount IS NULL OR ai_monthly_budget_amount >= 0)
    AND currency ~ '^[A-Z]{3}$'
  );

ALTER TABLE platform_invoices
  ADD CONSTRAINT platform_invoices_status_valid CHECK (status IN ('open', 'paid', 'void')),
  ADD CONSTRAINT platform_invoices_method_valid CHECK (
    method IS NULL OR method IN ('whish', 'omt', 'bank', 'cash', 'other')
  ),
  ADD CONSTRAINT platform_invoices_paid_valid CHECK ((status = 'paid') = (paid_at IS NOT NULL)),
  ADD CONSTRAINT platform_invoices_values_valid CHECK (
    amount >= 0 AND currency ~ '^[A-Z]{3}$' AND period_end > period_start
    AND btrim(description) <> '' AND char_length(description) <= 200
    AND (reference IS NULL OR char_length(reference) <= 200)
  );

ALTER TABLE platform_settings
  ADD CONSTRAINT platform_settings_single_row CHECK (id = 1),
  ADD CONSTRAINT platform_settings_text_valid CHECK (char_length(payment_instructions) <= 2000);

-- Plans and settings belong to the platform: the runtime role has no access.
-- A shop may read its own invoices (its billing page), nothing more.
ALTER TABLE platform_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON platform_invoices FOR SELECT
  USING (tenant_id = app_private.current_tenant_id());
GRANT SELECT ON platform_invoices TO app_user;
