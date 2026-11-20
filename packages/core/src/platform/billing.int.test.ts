import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTenantDb } from "../access/tenant-db";
import { seedSystemData } from "../identity/seed";
import { getShopBillingState } from "../tenancy/setup-checklist";
import {
  createInvoice,
  getShopBilling,
  listPlans,
  markInvoicePaid,
  savePaymentInstructions,
  savePlan,
  setShopPlan,
  shopsNeedingAttention,
  voidInvoice,
} from "./billing";
import { PlatformError } from "./shops";
import { signUpShop } from "./signup";

// Plans and payments against the real (test) database (D122).

const env = getEnv();
const url = env.DATABASE_ADMIN_URL;
const admin = getAdminPrisma(url);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8).replace(/-/g, "");
const actor = { userId: randomUUID(), ip: "203.0.113.122" };
const planKey = `it_${run}`;
const tenants: string[] = [];
const emails: string[] = [];
let tenantId: string;
let previousInstructions = "";

beforeAll(async () => {
  await seedSystemData(admin);
  previousInstructions =
    (await admin.platformSetting.findUnique({ where: { id: 1 } }))?.paymentInstructions ?? "";
  emails.push(`bill-${run}@example.test`);
  const shop = await signUpShop(
    url,
    {
      name: "Bill Owner",
      email: `bill-${run}@example.test`,
      password: "a-long-test-password",
      shopName: "Billing Shop",
      address: `bill-${run}`,
      template: "classic",
      acceptTerms: "on",
    },
    { suffix: "billing.test", platformHost: "platform.billing.test" },
  );
  tenantId = shop.tenantId;
  tenants.push(tenantId);
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenants } } });
  await admin.user.deleteMany({ where: { email: { in: emails } } });
  await admin.platformPlan.deleteMany({ where: { key: { startsWith: `it_${run}` } } });
  await admin.platformSetting.upsert({
    where: { id: 1 },
    create: { id: 1, paymentInstructions: previousInstructions },
    update: { paymentInstructions: previousInstructions },
  });
  await disconnectDatabase();
});

describe("plans", () => {
  it("creates and changes a plan with the price typed", async () => {
    const plan = await savePlan(url, actor, {
      key: planKey,
      name: "Starter",
      price: "25",
      productLimit: "100",
      staffLimit: "2",
      aiBudget: "5",
      isPublic: "on",
    });
    expect(plan).toMatchObject({
      priceAmount: 2500,
      currency: "USD",
      productLimit: 100,
      staffLimit: 2,
      aiMonthlyBudgetAmount: 500,
      isPublic: true,
    });
    const changed = await savePlan(url, actor, {
      id: plan.id,
      key: planKey,
      name: "Starter",
      price: "30",
    });
    expect(changed.priceAmount).toBe(3000);
    expect(changed.productLimit).toBeNull();
    expect((await listPlans(url, { publicOnly: true })).some((p) => p.key === planKey)).toBe(false);
    await savePlan(url, actor, {
      id: plan.id,
      key: planKey,
      name: "Starter",
      price: "25",
      aiBudget: "5",
      isPublic: "on",
    });
    expect((await listPlans(url, { publicOnly: true })).some((p) => p.key === planKey)).toBe(true);
  });

  it("refuses bad input", async () => {
    await expect(
      savePlan(url, actor, { key: "trial", name: "x", price: "1" }),
    ).rejects.toMatchObject({ field: "key" });
    await expect(
      savePlan(url, actor, { key: `${planKey}_b`, name: "", price: "1" }),
    ).rejects.toMatchObject({ field: "name" });
    await expect(
      savePlan(url, actor, { key: `${planKey}_b`, name: "B", price: "abc" }),
    ).rejects.toMatchObject({ field: "price" });
    await expect(
      savePlan(url, actor, { key: planKey, name: "Dup", price: "1" }),
    ).rejects.toBeInstanceOf(PlatformError);
  });
});

describe("billing a shop", () => {
  it("puts a shop on a plan, which sets its AI budget", async () => {
    await setShopPlan(url, actor, tenantId, planKey);
    const tenant = await admin.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.plan).toBe(planKey);
    expect(tenant.aiMonthlyBudgetAmount).toBe(500);
    // Back to the trial for the next steps (a sign-up pays from its trial).
    await admin.tenant.update({ where: { id: tenantId }, data: { plan: "trial" } });
  });

  it("invoices, records the payment and moves the paid-until date", async () => {
    const now = new Date("2026-12-10T12:00:00Z");
    const invoice = await createInvoice(url, actor, tenantId, { months: "3", planKey }, now);
    expect(invoice).toMatchObject({ amount: 7500, currency: "USD", status: "open", planKey });
    expect(invoice.number).toMatch(/^INV-2026-\d{4}$/);
    expect(invoice.periodStart.toISOString()).toBe(now.toISOString());
    expect(invoice.periodEnd.toISOString()).toBe("2027-03-10T12:00:00.000Z");

    await expect(
      markInvoicePaid(url, actor, invoice.id, { method: "bitcoin" }),
    ).rejects.toMatchObject({ field: "method" });
    await markInvoicePaid(url, actor, invoice.id, { method: "whish", reference: "W-123" }, now);
    const tenant = await admin.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    expect(tenant.paidUntil?.toISOString()).toBe("2027-03-10T12:00:00.000Z");
    expect(tenant.plan).toBe(planKey);
    await expect(
      markInvoicePaid(url, actor, invoice.id, { method: "cash" }),
    ).rejects.toBeInstanceOf(PlatformError);

    // The next invoice starts where the paid time ends.
    const next = await createInvoice(url, actor, tenantId, { months: "1" }, now);
    expect(next.periodStart.toISOString()).toBe("2027-03-10T12:00:00.000Z");
    await voidInvoice(url, actor, next.id);
    expect((await admin.platformInvoice.findUniqueOrThrow({ where: { id: next.id } })).status).toBe(
      "void",
    );

    const audit = await admin.auditLog.findMany({
      where: { tenantId, action: { startsWith: "platform.invoice_" } },
      select: { action: true },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      "platform.invoice_created",
      "platform.invoice_created",
      "platform.invoice_paid",
      "platform.invoice_voided",
    ]);
  });

  it("shows the shop its own invoices and the payment instructions", async () => {
    await savePaymentInstructions(url, actor, "Whish: 70 000 000");
    const billing = await getShopBilling(url, tenantId, new Date("2026-12-10T12:00:00Z"));
    expect(billing.state).toBe("paid");
    expect(billing.plan?.key).toBe(planKey);
    expect(billing.paymentInstructions).toBe("Whish: 70 000 000");
    // Cancelled invoices are not shown to the shop.
    expect(billing.invoices.map((i) => i.status)).toEqual(["paid"]);
  });

  it("lets a shop read only its own invoices", async () => {
    const own = createTenantDb(app, { tenantId });
    const seen = await own.run((tx) => tx.platformInvoice.findMany({ select: { tenantId: true } }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((i) => i.tenantId === tenantId)).toBe(true);
    // No writes, and no access to plans or settings.
    await expect(
      own.run((tx) => tx.platformInvoice.updateMany({ data: { status: "paid" } })),
    ).rejects.toThrow();
    await expect(own.run((tx) => tx.platformPlan.findMany())).rejects.toThrow();
    await expect(own.run((tx) => tx.platformSetting.findMany())).rejects.toThrow();
  });

  it("flags overdue shops for the platform owner and the shop", async () => {
    const later = new Date("2027-04-01T00:00:00Z");
    const list = await shopsNeedingAttention(url, later);
    expect(list.find((s) => s.id === tenantId)?.state).toBe("overdue");
    expect(await getShopBillingState(createTenantDb(app, { tenantId }), later)).toBe("overdue");
  });
});
