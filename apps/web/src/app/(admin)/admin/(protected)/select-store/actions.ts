"use server";

import { notFound, redirect } from "next/navigation";
import { getAccessService, getRequestId } from "@/server/access";
import { getRequestInfo, requireSession } from "@/server/auth";

/**
 * Makes one of the user's tenants the working tenant for this session. The
 * tenant ID from the form is only a choice among the user's own memberships;
 * anything else is answered exactly like a tenant that does not exist.
 */
export async function selectStoreAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const tenantId = formData.get("tenantId");
  if (typeof tenantId !== "string") notFound();

  const [{ ip }, requestId] = await Promise.all([getRequestInfo(), getRequestId()]);
  const changed = await getAccessService().setActiveTenant({ session, tenantId, requestId, ip });
  if (!changed) notFound();
  redirect("/admin");
}
