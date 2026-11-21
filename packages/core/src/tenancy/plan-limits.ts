import type { TenantDb } from "../access/tenant-db";

// What a shop's plan allows (decision D123). Read through a database function
// that returns only the current shop's plan, so the runtime role still cannot
// read the plans table. A shop on its free trial, set up by hand (no plan) or
// on a plan that no longer exists has no limits: limits come only from a plan
// the platform owner priced.

export const PLAN_FEATURES = ["scheduled_posts", "campaigns", "own_domain"] as const;
export type PlanFeature = (typeof PLAN_FEATURES)[number];

export const PLAN_FEATURE_LABELS: Record<PlanFeature, string> = {
  scheduled_posts: "Scheduled posts",
  campaigns: "Campaigns and customer segments",
  own_domain: "Own domain",
};

export interface PlanLimits {
  plan: string | null;
  /** False on the trial, without a plan, or when the plan is not found: no limits apply. */
  limited: boolean;
  productLimit: number | null;
  staffLimit: number | null;
  features: PlanFeature[];
}

const UNLIMITED = (plan: string | null): PlanLimits => ({
  plan,
  limited: false,
  productLimit: null,
  staffLimit: null,
  features: [...PLAN_FEATURES],
});

type Tx = Parameters<Parameters<TenantDb["run"]>[0]>[0];

/** The current shop's limits, inside an existing tenant transaction. */
export async function planLimitsIn(tx: Tx): Promise<PlanLimits> {
  const rows = await tx.$queryRaw<
    {
      plan: string | null;
      plan_found: boolean;
      product_limit: number | null;
      staff_limit: number | null;
      features: string[];
    }[]
  >`SELECT plan, plan_found, product_limit, staff_limit, features FROM app_private.current_plan_limits()`;
  const row = rows[0];
  if (!row || !row.plan || row.plan === "trial" || !row.plan_found)
    return UNLIMITED(row?.plan ?? null);
  return {
    plan: row.plan,
    limited: true,
    productLimit: row.product_limit,
    staffLimit: row.staff_limit,
    features: PLAN_FEATURES.filter((f) => row.features.includes(f)),
  };
}

export async function getPlanLimits(db: TenantDb): Promise<PlanLimits> {
  return db.run((tx) => planLimitsIn(tx));
}

/** Products that count against the limit: everything except archived ones. */
export async function countedProducts(tx: Tx): Promise<number> {
  return tx.product.count({ where: { status: { not: "archived" } } });
}

/**
 * Why adding `adding` products would go over the plan, or null when it fits.
 * Counted inside the caller's transaction, so the check and the insert agree.
 */
export async function productLimitProblem(tx: Tx, adding = 1): Promise<string | null> {
  const limits = await planLimitsIn(tx);
  if (limits.productLimit === null) return null;
  const now = await countedProducts(tx);
  if (now + adding <= limits.productLimit) return null;
  const left = Math.max(0, limits.productLimit - now);
  return adding === 1 || left === 0
    ? `Your plan includes ${limits.productLimit} products and you have ${now}. Archive products you no longer sell, or upgrade your plan under Settings > Plan and billing.`
    : `Your plan includes ${limits.productLimit} products: you have ${now}, so ${left} more fit, not ${adding}. Import fewer, archive old products, or upgrade your plan.`;
}

/** Why the plan does not include this feature, or null when it does. */
export async function featureProblem(tx: Tx, feature: PlanFeature): Promise<string | null> {
  const limits = await planLimitsIn(tx);
  if (limits.features.includes(feature)) return null;
  return `${PLAN_FEATURE_LABELS[feature]} ${feature === "own_domain" ? "is" : "are"} not included in your plan. Upgrade under Settings > Plan and billing.`;
}

/** What the shop uses against its plan, for its billing page. */
export async function getPlanUsage(db: TenantDb): Promise<{
  limits: PlanLimits;
  products: number;
  staff: number;
}> {
  return db.run(async (tx) => ({
    limits: await planLimitsIn(tx),
    products: await countedProducts(tx),
    staff: await tx.userTenantMembership.count({ where: { status: "active" } }),
  }));
}
