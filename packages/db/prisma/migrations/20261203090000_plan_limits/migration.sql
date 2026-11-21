-- AlterTable
ALTER TABLE "platform_plans" ADD COLUMN     "features" TEXT[] DEFAULT ARRAY[]::TEXT[];


-- Hand-written (D123): the features a plan may include.
ALTER TABLE platform_plans ADD CONSTRAINT platform_plans_features_valid CHECK (
  features <@ ARRAY['scheduled_posts', 'campaigns', 'own_domain']::text[]
);

-- What the current shop's plan allows, for the runtime role, which cannot
-- read plans. Returns one row: the shop's plan key and, when that plan
-- exists, its limits and features. Nothing about any other shop or plan.
CREATE OR REPLACE FUNCTION app_private.current_plan_limits()
  RETURNS TABLE (plan text, plan_found boolean, product_limit integer, staff_limit integer, features text[])
  LANGUAGE sql STABLE SECURITY DEFINER
  SET search_path = public, pg_temp
  AS $$
    SELECT t.plan, p.id IS NOT NULL, p.product_limit, p.staff_limit, coalesce(p.features, ARRAY[]::text[])
    FROM tenants t
    LEFT JOIN platform_plans p ON p.key = t.plan
    WHERE t.id = app_private.current_tenant_id()
  $$;

REVOKE ALL ON FUNCTION app_private.current_plan_limits() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app_private.current_plan_limits() TO app_user;
