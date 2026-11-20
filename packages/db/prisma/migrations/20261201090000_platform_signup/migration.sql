-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "plan" TEXT,
ADD COLUMN     "trial_ends_at" TIMESTAMPTZ(3);


-- Hand-written (D121): a plan is a short key; a trial has an end date.
ALTER TABLE "tenants" ADD CONSTRAINT tenants_plan_key CHECK (plan IS NULL OR plan ~ '^[a-z][a-z0-9_]{0,29}$');
ALTER TABLE "tenants" ADD CONSTRAINT tenants_trial_has_end CHECK (plan IS DISTINCT FROM 'trial' OR trial_ends_at IS NOT NULL);
