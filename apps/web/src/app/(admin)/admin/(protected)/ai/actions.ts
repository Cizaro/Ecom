"use server";

import {
  AiSettingsError,
  ForbiddenError,
  saveAiSettings,
  saveBusinessProfile,
  tryCustomerAnswer,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden } from "next/navigation";
import { aiGateway } from "@/server/ai";
import { requirePermission, tenantDb } from "@/server/access";
import type { FormState } from "../../actions";

// The AI page: settings and the business profile (ai.configure), and trying
// the customer-answer task (ai.use). Each action checks the permission; the
// services check it again inside the staff member's tenant.

const PAGE = "/admin/ai";

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function attempt(
  work: () => Promise<FormState>,
  values: Record<string, string>,
): Promise<FormState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AiSettingsError) return { error: error.message, values };
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

export async function saveAiSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("ai.configure");
  const values = {
    paused: formData.get("paused") === "on" ? "on" : "",
    monthlyBudgetUsd: field(formData, "monthlyBudgetUsd"),
    automation: field(formData, "automation"),
  };
  return attempt(async () => {
    await saveAiSettings(tenantDb(context), context, values);
    revalidatePath(PAGE);
    return { notice: "AI settings saved." };
  }, values);
}

export async function saveBusinessProfileAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("ai.configure");
  const values = Object.fromEntries(
    ["name", "description", "tone", "mayPromise", "neverPromise", "handoverTopics", "contact"].map(
      (name) => [name, field(formData, name)],
    ),
  );
  return attempt(async () => {
    await saveBusinessProfile(tenantDb(context), context, {
      name: values.name,
      description: values.description,
      tone: values.tone,
      mayPromise: values.mayPromise,
      neverPromise: values.neverPromise,
      handoverTopics: values.handoverTopics,
      contact: values.contact,
    });
    revalidatePath(PAGE);
    return { notice: "Business profile saved." };
  }, values);
}

export interface TryAnswerState {
  error?: string;
  question?: string;
  language?: string;
  result?: {
    answered: boolean;
    reply: string;
    topic: string;
    handover: boolean;
    route: string;
    citations: { id: string; text: string }[];
  };
}

/** A draft answer to a test question. Nothing is sent to any customer. */
export async function tryAnswerAction(
  _previous: TryAnswerState,
  formData: FormData,
): Promise<TryAnswerState> {
  const { context } = await requirePermission("ai.use");
  const question = field(formData, "question").slice(0, 4000);
  const language = field(formData, "language") === "ar" ? "ar" : "en";
  const run = await tryCustomerAnswer(tenantDb(context), context, aiGateway(context.userId), {
    question,
    language,
  });
  revalidatePath(PAGE);
  if (!run.ok) return { error: run.message, question, language };
  const facts = new Map(run.facts.map((fact) => [fact.id, fact.text]));
  return {
    question,
    language,
    result: {
      answered: run.output.answered,
      reply: run.output.reply,
      topic: run.output.topic,
      handover: run.output.handover,
      route: run.route,
      citations: run.output.citations.map((id) => ({ id, text: facts.get(id) ?? "" })),
    },
  };
}
