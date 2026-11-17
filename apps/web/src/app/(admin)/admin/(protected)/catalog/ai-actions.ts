"use server";

import {
  applyProductSuggestion,
  dismissProductSuggestion,
  draftProductCopy,
  draftProductTranslation,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { aiGateway } from "@/server/ai";
import { requirePermission, tenantDb } from "@/server/access";
import { attempt, field } from "@/server/catalog-forms";
import type { FormState } from "../../actions";

// AI drafts on a product's page (Milestone 5.2). Each action checks
// catalog.write; the services also require ai.use and run inside the staff
// member's tenant. A draft never changes the product until staff apply it.

const productPage = (id: string) => `/admin/catalog/products/${id}`;

export async function draftProductCopyAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const result = await attempt(() =>
    draftProductCopy(tenantDb(context), context, aiGateway(context.userId), id),
  );
  if (!result.ok) return result.state;
  if (!result.value.ok) return { error: result.value.message };
  revalidatePath(productPage(id));
  return { notice: "Draft ready below. Nothing changes until you apply it." };
}

export async function draftProductTranslationAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const result = await attempt(() =>
    draftProductTranslation(tenantDb(context), context, aiGateway(context.userId), id, "ar"),
  );
  if (!result.ok) return result.state;
  if (!result.value.ok) return { error: result.value.message };
  revalidatePath(productPage(id));
  return { notice: "Arabic draft ready below. Nothing changes until you apply it." };
}

export async function applyProductSuggestionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const fields = formData.getAll("fields").filter((value) => typeof value === "string");
  const result = await attempt(() =>
    applyProductSuggestion(tenantDb(context), context, id, field(formData, "suggestionId"), fields),
  );
  if (!result.ok) return result.state;
  revalidatePath(productPage(id));
  revalidatePath("/", "layout");
  return { notice: "Applied to the product." };
}

export async function dismissProductSuggestionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const result = await attempt(() =>
    dismissProductSuggestion(tenantDb(context), context, id, field(formData, "suggestionId")),
  );
  if (!result.ok) return result.state;
  revalidatePath(productPage(id));
  return { notice: "Draft dismissed." };
}
