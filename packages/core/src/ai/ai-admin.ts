import {
  businessProfileSchema,
  dollarsToMicros,
  readProfile,
  type AiEvent,
  type AiGateway,
  type AiLedger,
  type Automation,
  type BusinessProfile,
  type CustomerAnswerOutput,
  type Fact,
  type RunResult,
  type TenantAiSettings,
} from "@ecom/ai";
import type { AppPrismaClient } from "@ecom/db";
import { Prisma } from "@ecom/db";
import { assertPermission, type RequestContext } from "../access/context";
import { audit, createTenantDb, type TenantDb } from "../access/tenant-db";
import { parseBranding } from "../tenancy/branding";
import { storeLanguages } from "../tenancy/store-host";
import { createCommerceKnowledge } from "./commerce-knowledge";

// The platform's side of the AI module: where each business's AI settings,
// profile and audit trail are kept (the ledger), and the admin services.
// Every read and write runs inside the business's own tenant.

export class AiSettingsError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "AiSettingsError";
  }
}

const AUTOMATIONS: readonly Automation[] = ["draft", "approval", "auto"];

const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

/** The AI ledger on the database, for one staff member (or the system). */
export function createAiLedger(app: AppPrismaClient, userId: string | null): AiLedger {
  const shop = (tenantId: string) => createTenantDb(app, { tenantId });
  return {
    async settings(tenantId) {
      const row = await shop(tenantId).run((tx) =>
        tx.aiSettings.findUnique({ where: { tenantId } }),
      );
      return {
        paused: row?.paused ?? false,
        monthlyBudgetMicros: row?.monthlyBudgetMicros ?? null,
        automation: AUTOMATIONS.find((a) => a === row?.automation) ?? "approval",
      } satisfies TenantAiSettings;
    },
    async spentThisMonth(tenantId, now) {
      const sum = await shop(tenantId).run((tx) =>
        tx.aiEvent.aggregate({
          where: { createdAt: { gte: monthStart(now) } },
          _sum: { costMicros: true },
        }),
      );
      return sum._sum.costMicros ?? 0;
    },
    async record(event: AiEvent) {
      const json = (value: unknown) =>
        value === null || value === undefined
          ? Prisma.DbNull
          : (JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue);
      const row = await shop(event.tenantId).run((tx) =>
        tx.aiEvent.create({
          data: {
            tenantId: event.tenantId,
            task: event.task,
            provider: event.provider,
            model: event.model,
            status: event.status,
            route: event.route,
            inputTokens: event.inputTokens,
            outputTokens: event.outputTokens,
            costMicros: event.costMicros,
            latencyMs: event.latencyMs,
            problem: event.problem?.slice(0, 1000) ?? null,
            input: json(event.input),
            output: json(event.output),
            factIds: event.factIds.slice(0, 50),
            userId,
          },
          select: { id: true },
        }),
      );
      return row.id;
    },
  };
}

async function storeIn(db: TenantDb) {
  return db.run(async (tx) => {
    const store = await tx.store.findFirst({
      select: { name: true, branding: true, defaultLocale: true, languages: true },
      orderBy: { createdAt: "asc" },
    });
    return {
      name: store?.name ?? "Our store",
      branding: parseBranding(store?.branding ?? {}),
      languages: storeLanguages(store?.defaultLocale ?? "en", store?.languages ?? []).languages,
    };
  });
}

/** The business profile, or a starting one built from the store's name and languages. */
export async function getBusinessProfile(db: TenantDb): Promise<BusinessProfile> {
  const [store, row] = await Promise.all([
    storeIn(db),
    db.run((tx) => tx.businessProfile.findUnique({ where: { tenantId: db.tenantId } })),
  ]);
  return readProfile(row?.profile, store.name, store.languages);
}

export interface AiOverview {
  settings: TenantAiSettings;
  profile: BusinessProfile;
  spentMicros: number;
  abilities: { id: string; description: string }[];
  recent: {
    id: string;
    task: string;
    status: string;
    route: string | null;
    model: string;
    costMicros: number;
    problem: string | null;
    createdAt: Date;
  }[];
}

export async function getAiOverview(
  db: TenantDb,
  context: RequestContext,
  ledger: AiLedger,
  now = new Date(),
): Promise<AiOverview> {
  assertPermission(context, "ai.use");
  const [settings, profile, spentMicros, store, recent] = await Promise.all([
    ledger.settings(db.tenantId),
    getBusinessProfile(db),
    ledger.spentThisMonth(db.tenantId, now),
    storeIn(db),
    db.run((tx) =>
      tx.aiEvent.findMany({
        orderBy: { createdAt: "desc" },
        take: 20,
        select: {
          id: true,
          task: true,
          status: true,
          route: true,
          model: true,
          costMicros: true,
          problem: true,
          createdAt: true,
        },
      }),
    ),
  ]);
  return {
    settings,
    profile,
    spentMicros,
    abilities: createCommerceKnowledge(db, store).abilities(),
    recent,
  };
}

/** Pause or resume AI, set this business's monthly budget and how much it decides alone. */
export async function saveAiSettings(
  db: TenantDb,
  context: RequestContext,
  input: { paused: unknown; monthlyBudgetUsd: unknown; automation: unknown },
): Promise<void> {
  assertPermission(context, "ai.configure");
  const automation = AUTOMATIONS.find((a) => a === input.automation);
  if (!automation) throw new AiSettingsError("Choose how much the AI may do alone.", "automation");
  const budgetText =
    typeof input.monthlyBudgetUsd === "string" ? input.monthlyBudgetUsd.trim() : "";
  let monthlyBudgetMicros: number | null = null;
  if (budgetText !== "") {
    const dollars = Number(budgetText);
    if (!/^\d{1,6}(\.\d{1,2})?$/.test(budgetText) || dollars > 2000) {
      throw new AiSettingsError(
        "Enter the monthly budget in dollars, such as 20, up to 2,000, or leave it empty.",
        "monthlyBudgetUsd",
      );
    }
    monthlyBudgetMicros = dollarsToMicros(dollars);
  }
  const paused = input.paused === true || input.paused === "on";
  await db.run(async (tx) => {
    const data = { paused, monthlyBudgetMicros, automation, updatedByUserId: context.userId };
    await tx.aiSettings.upsert({
      where: { tenantId: db.tenantId },
      create: { tenantId: db.tenantId, ...data },
      update: data,
    });
    await audit(tx, context, "ai.settings_updated", { type: "ai_settings", id: null }, undefined, {
      paused,
      monthlyBudgetMicros,
      automation,
    });
  });
}

const lines = (value: unknown) =>
  typeof value === "string"
    ? value
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    : [];

/** What the AI is told about the business. */
export async function saveBusinessProfile(
  db: TenantDb,
  context: RequestContext,
  input: {
    name: unknown;
    description: unknown;
    tone: unknown;
    mayPromise: unknown;
    neverPromise: unknown;
    handoverTopics: unknown;
    contact: unknown;
  },
): Promise<void> {
  assertPermission(context, "ai.configure");
  const store = await storeIn(db);
  const parsed = businessProfileSchema.safeParse({
    name: input.name,
    description: input.description,
    tone: input.tone,
    languages: store.languages,
    mayPromise: lines(input.mayPromise),
    neverPromise: lines(input.neverPromise),
    handoverTopics: lines(input.handoverTopics),
    contact: typeof input.contact === "string" ? input.contact : "",
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    const field = String(issue.path[0] ?? "");
    throw new AiSettingsError(
      issue.message.startsWith("Too") || issue.message.startsWith("Invalid")
        ? "Check this field: lists can have 20 lines of 300 characters at most."
        : issue.message,
      field,
    );
  }
  await db.run(async (tx) => {
    const profile = parsed.data as unknown as Prisma.InputJsonObject;
    await tx.businessProfile.upsert({
      where: { tenantId: db.tenantId },
      create: { tenantId: db.tenantId, profile, updatedByUserId: context.userId },
      update: { profile, updatedByUserId: context.userId },
    });
    await audit(tx, context, "ai.profile_updated", { type: "business_profile", id: null });
  });
}

/** Staff try the customer-answer task on a question: a draft, never sent to anyone. */
export async function tryCustomerAnswer(
  db: TenantDb,
  context: RequestContext,
  gateway: AiGateway,
  input: { question: unknown; language: unknown },
): Promise<RunResult<CustomerAnswerOutput> & { facts?: Fact[] }> {
  assertPermission(context, "ai.use");
  return answerCustomerQuestion(db, gateway, input);
}

/**
 * Drafts an answer to a customer's question in two AI steps: first search
 * words in the language the store's records use (so a question in Lebanese
 * Arabic or Arabizi finds its products), then the answer from the facts
 * those words and the question find. If the first step does not work (busy,
 * paused, a bad answer), the answer is drafted from the question alone.
 * No permission check: callers check (staff screens) or are the system.
 */
export async function answerCustomerQuestion(
  db: TenantDb,
  gateway: AiGateway,
  input: {
    question: unknown;
    language: unknown;
    /** Earlier messages of the conversation, oldest first. */
    history?: { from: "customer" | "business"; text: string }[];
  },
): Promise<RunResult<CustomerAnswerOutput> & { facts?: Fact[] }> {
  const [store, profile] = await Promise.all([storeIn(db), getBusinessProfile(db)]);
  const context = { tenantId: db.tenantId, profile, knowledge: createCommerceKnowledge(db, store) };
  const words = await gateway.run(
    "search.terms",
    { question: input.question, recordsLanguage: store.languages[0] ?? "en" },
    context,
  );
  return gateway.run(
    "customer.answer",
    {
      question: input.question,
      language: input.language,
      ...(words.ok && words.output.terms.length > 0 ? { terms: words.output.terms } : {}),
      ...(input.history && input.history.length > 0 ? { history: input.history } : {}),
    },
    context,
  );
}
