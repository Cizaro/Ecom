import type { TenantDb } from "../access/tenant-db";

// The setup guide on a shop's dashboard (D121): the few things a new shop
// needs before it can sell, each ticked off from the shop's real data, so
// it never says "done" for something that is not.

export interface SetupStep {
  key: "look" | "contact" | "delivery" | "product" | "policies" | "social";
  title: string;
  text: string;
  href: string;
  done: boolean;
}

export interface SetupChecklist {
  steps: SetupStep[];
  done: number;
  /** "trial" for a sign-up on a free trial; null otherwise. */
  plan: string | null;
  trialEndsAt: Date | null;
}

export async function getSetupChecklist(db: TenantDb): Promise<SetupChecklist> {
  const data = await db.run(async (tx) => {
    const tenant = await tx.tenant.findUnique({
      where: { id: db.tenantId },
      select: { plan: true, trialEndsAt: true },
    });
    const store = await tx.store.findFirst({
      orderBy: { createdAt: "asc" },
      select: { logoAssetId: true, branding: true },
    });
    const products = await tx.product.count({ where: { status: "active" } });
    const zones = await tx.shippingZone.count({ where: { isActive: true } });
    const policies = await tx.storePage.count({ where: { published: true } });
    const social = await tx.socialConnection.count();
    return { tenant, store, products, zones, policies, social };
  });
  const branding = (data.store?.branding ?? {}) as Record<string, unknown>;
  const steps: SetupStep[] = [
    {
      key: "look",
      title: "Add your logo",
      text: "Upload your logo and adjust the colours and font.",
      href: "/admin/settings/store",
      done: Boolean(data.store?.logoAssetId),
    },
    {
      key: "contact",
      title: "Add a phone number",
      text: "Shown in the shop's footer so customers can reach you.",
      href: "/admin/settings/store",
      done: typeof branding.contactPhone === "string" && branding.contactPhone.trim() !== "",
    },
    {
      key: "delivery",
      title: "Set up delivery",
      text: "Where you deliver and what it costs, e.g. Beirut and the rest of Lebanon.",
      href: "/admin/settings/shipping",
      done: data.zones > 0,
    },
    {
      key: "product",
      title: "Add your first product",
      text: "One by one, or many at once from a spreadsheet.",
      href: "/admin/catalog/products/new",
      done: data.products > 0,
    },
    {
      key: "policies",
      title: "Publish your policies",
      text: "Returns, delivery and privacy pages for your customers.",
      href: "/admin/settings/pages",
      done: data.policies > 0,
    },
    {
      key: "social",
      title: "Connect Instagram and Facebook",
      text: "So the AI assistant can answer your messages and comments.",
      href: "/admin/social",
      done: data.social > 0,
    },
  ];
  return {
    steps,
    done: steps.filter((s) => s.done).length,
    plan: data.tenant?.plan ?? null,
    trialEndsAt: data.tenant?.trialEndsAt ?? null,
  };
}
