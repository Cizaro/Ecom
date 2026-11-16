"use server";

import { getEnv } from "@ecom/config";
import {
  checkProductImport,
  discardProductImport,
  ForbiddenError,
  ImportError,
  NotFoundError,
  processImportImages,
  runProductImport,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { forbidden, notFound, redirect } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import { mediaDeps } from "@/server/media";
import type { FormState } from "../../../actions";

// Product import. Every action checks catalog.write itself; the services
// check it again (and inventory.adjust for opening stock), run inside the
// staff member's tenant and write the audit log.

const PAGE = "/admin/catalog/import";

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

function handled(error: unknown): FormState {
  if (error instanceof ImportError) return { error: error.message };
  if (error instanceof NotFoundError) notFound();
  if (error instanceof ForbiddenError) forbidden();
  throw error;
}

/** Step 1: reads and checks the file; shows the result page. Nothing is created. */
export async function checkImportAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a file to import." };
  if (file.size > 2 * 1024 * 1024) {
    return { error: "The file is too large (2 MB at most). Split it into smaller files." };
  }
  let id: string;
  try {
    ({ id } = await checkProductImport(tenantDb(context), context, {
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
    }));
  } catch (error) {
    return handled(error);
  }
  redirect(`${PAGE}/${id}`);
}

/** Step 2: creates the products, then starts on the pictures. */
export async function runImportAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  const id = field(formData, "id");
  const db = tenantDb(context);
  try {
    await runProductImport(db, context, id, { publish: formData.get("publish") === "on" });
  } catch (error) {
    return handled(error);
  }
  // A first batch of pictures now (up to about 20 seconds); the worker does the rest.
  await processImportImages(db, mediaDeps(), {
    limit: 20,
    deadline: Date.now() + 20_000,
    allowPrivateHosts: getEnv().IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS,
  }).catch(() => undefined);
  revalidatePath("/admin/catalog/products");
  revalidatePath(`${PAGE}/${id}`);
  redirect(`${PAGE}/${id}`);
}

export async function discardImportAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("catalog.write");
  try {
    await discardProductImport(tenantDb(context), context, field(formData, "id"));
  } catch (error) {
    return handled(error);
  }
  redirect(PAGE);
}
