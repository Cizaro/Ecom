-- CreateTable
CREATE TABLE "ai_settings" (
    "tenant_id" UUID NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "monthly_budget_micros" INTEGER,
    "automation" TEXT NOT NULL DEFAULT 'approval',
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ai_settings_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "business_profiles" (
    "tenant_id" UUID NOT NULL,
    "profile" JSONB NOT NULL,
    "updated_by_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("tenant_id")
);

-- CreateTable
CREATE TABLE "ai_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "route" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "problem" TEXT,
    "input" JSONB,
    "output" JSONB,
    "fact_ids" TEXT[],
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_events_tenant_id_created_at_idx" ON "ai_events"("tenant_id", "created_at");

-- AddForeignKey
ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_events" ADD CONSTRAINT "ai_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;



-- Hand-written: rules the schema language cannot express.
ALTER TABLE ai_settings
  ADD CONSTRAINT ai_settings_automation_valid CHECK (automation IN ('draft', 'approval', 'auto')),
  ADD CONSTRAINT ai_settings_budget_valid CHECK (
    monthly_budget_micros IS NULL OR monthly_budget_micros BETWEEN 0 AND 2000000000
  );
ALTER TABLE ai_events
  ADD CONSTRAINT ai_events_status_valid CHECK (status IN (
    'ok', 'paused', 'over_budget', 'invalid_input', 'invalid_output', 'refused', 'provider_error'
  )),
  ADD CONSTRAINT ai_events_route_valid CHECK (route IS NULL OR route IN ('draft', 'needs_approval', 'auto')),
  ADD CONSTRAINT ai_events_numbers_valid CHECK (
    input_tokens >= 0 AND output_tokens >= 0 AND cost_micros >= 0 AND latency_ms >= 0
  );

ALTER TABLE ai_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_settings FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE business_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON business_profiles FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());
ALTER TABLE ai_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ai_events FOR ALL
  USING (tenant_id = app_private.current_tenant_id())
  WITH CHECK (tenant_id = app_private.current_tenant_id());

GRANT SELECT, INSERT, UPDATE ON ai_settings, business_profiles TO app_user;
-- The audit trail is written once and never changed by the app.
GRANT SELECT, INSERT ON ai_events TO app_user;
