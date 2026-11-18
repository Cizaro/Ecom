"use server";

import {
  addObservation,
  decideIdea,
  deleteObservation,
  draftResearchIdeas,
  ForbiddenError,
  NotFoundError,
  ResearchError,
  saveCompetitor,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound, redirect } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import { aiGateway } from "@/server/ai";
import type { FormState } from "../../actions";

// Competitor research (Milestone 7.2, decision D108). Each action needs
// research.write; drafting ideas also needs ai.use, which the service checks.
// Everything is typed by staff: nothing is collected from other sites.

const RESEARCH = "/admin/research";

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

async function attempt(
  work: () => Promise<FormState>,
  values?: Record<string, string>,
): Promise<FormState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof ResearchError) return { error: error.message, values };
    if (error instanceof NotFoundError) notFound();
    if (error instanceof ForbiddenError) forbidden();
    throw error;
  }
}

const COMPETITOR_FIELDS = [
  "name",
  "website",
  "instagram",
  "facebook",
  "tiktok",
  "tags",
  "notes",
] as const;

export async function saveCompetitorAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("research.write");
  const id = field(formData, "id") || null;
  const values = Object.fromEntries(
    COMPETITOR_FIELDS.map((n) => [n, field(formData, n)]),
  ) as Record<(typeof COMPETITOR_FIELDS)[number], string>;
  let createdId = "";
  const result = await attempt(async () => {
    const saved = await saveCompetitor(tenantDb(context), context, id, {
      ...values,
      archived: formData.get("archived") === "on",
    });
    if (!id) createdId = saved.id;
    revalidatePath(RESEARCH);
    if (id) revalidatePath(`${RESEARCH}/${id}`);
    return { notice: "Saved." };
  }, values);
  if (createdId) redirect(`${RESEARCH}/${createdId}`);
  return result;
}

const OBSERVATION_FIELDS = [
  "kind",
  "title",
  "detail",
  "price",
  "sourceUrl",
  "observedOn",
  "productId",
] as const;

export async function addObservationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("research.write");
  const competitorId = field(formData, "competitorId");
  const values = Object.fromEntries(
    OBSERVATION_FIELDS.map((n) => [n, field(formData, n)]),
  ) as Record<(typeof OBSERVATION_FIELDS)[number], string>;
  return attempt(async () => {
    await addObservation(tenantDb(context), context, competitorId, values);
    revalidatePath(RESEARCH);
    revalidatePath(`${RESEARCH}/${competitorId}`);
    return { notice: "Observation added." };
  }, values);
}

export async function deleteObservationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("research.write");
  return attempt(async () => {
    await deleteObservation(tenantDb(context), context, field(formData, "id"));
    revalidatePath(RESEARCH);
    revalidatePath(`${RESEARCH}/${field(formData, "competitorId")}`);
    return { notice: "Observation deleted." };
  });
}

export async function draftIdeasAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("research.write");
  const focus = field(formData, "focus");
  return attempt(
    async () => {
      const result = await draftResearchIdeas(
        tenantDb(context),
        context,
        aiGateway(context.userId),
        { focus },
      );
      if (!result.ok) return { error: result.message, values: { focus } };
      revalidatePath(`${RESEARCH}/ideas`);
      return {
        notice: `${result.count} ${result.count === 1 ? "idea" : "ideas"} drafted. They are suggestions: check them against what you saw.`,
      };
    },
    { focus },
  );
}

export async function decideIdeaAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("research.write");
  const decision = field(formData, "decision");
  return attempt(async () => {
    await decideIdea(tenantDb(context), context, field(formData, "id"), decision);
    revalidatePath(`${RESEARCH}/ideas`);
    return { notice: decision === "accepted" ? "Kept." : "Dismissed." };
  });
}
