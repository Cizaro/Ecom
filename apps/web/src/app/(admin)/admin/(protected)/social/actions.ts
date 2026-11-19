"use server";

import { getEnv } from "@ecom/config";
import { connectMetaPage, disconnectMeta, MetaError, SocialError } from "@ecom/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission, tenantDb } from "@/server/access";
import {
  beginMetaSignIn,
  clearPendingToken,
  getMetaGraph,
  pendingToken,
  SOCIAL_PAGE,
} from "@/server/social";
import type { FormState } from "../../actions";
import type { ConnectState } from "./connect-form";

// Connecting the store's Facebook Page and Instagram account (Milestone 6.3,
// D112). Only the owner (social.connect). The sign-in itself happens on
// Meta's site; nothing here ever sees a Facebook password.

const NOT_SET_UP = "Meta is not set up for this installation yet (see docs/META_SETUP.md).";

export async function connectMetaAction(_previous: ConnectState): Promise<ConnectState> {
  const { context } = await requirePermission("social.connect");
  const graph = getMetaGraph();
  if (!graph) return { error: NOT_SET_UP };
  return { goTo: await beginMetaSignIn(context, graph) };
}

export async function choosePageAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const { context } = await requirePermission("social.connect");
  const graph = getMetaGraph();
  if (!graph) return { error: NOT_SET_UP };
  const userToken = await pendingToken(context);
  if (!userToken) return { error: "Your Meta sign-in has expired. Connect again." };
  const pageId = formData.get("pageId");
  try {
    await connectMetaPage(
      tenantDb(context),
      context,
      { graph, encryptionKey: getEnv().ENCRYPTION_KEY },
      { userToken, pageId: typeof pageId === "string" ? pageId : "" },
    );
  } catch (error) {
    if (error instanceof SocialError || error instanceof MetaError) return { error: error.message };
    throw error;
  }
  await clearPendingToken();
  revalidatePath(SOCIAL_PAGE);
  redirect(`${SOCIAL_PAGE}?connected=1`);
}

export async function disconnectMetaAction(_previous: FormState): Promise<FormState> {
  const { context } = await requirePermission("social.connect");
  const graph = getMetaGraph();
  if (!graph) return { error: NOT_SET_UP };
  await disconnectMeta(tenantDb(context), context, {
    graph,
    encryptionKey: getEnv().ENCRYPTION_KEY,
  });
  await clearPendingToken();
  revalidatePath(SOCIAL_PAGE);
  redirect(`${SOCIAL_PAGE}?disconnected=1`);
}
