import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";
import { getEnv } from "@ecom/config";
import {
  createFakeMetaGraph,
  createMetaGraph,
  openSecret,
  sealSecret,
  type MetaGraph,
  type RequestContext,
} from "@ecom/core";
import { cookies } from "next/headers";

// Meta sign-in for the web app (Milestone 6.3, D112): the configured Graph
// client, and the two short-lived, encrypted cookies of a sign-in in
// progress. "meta_oauth" carries the state that must come back from Meta
// (against forged callbacks); "meta_pending" carries the person's user token
// between the callback and choosing a Page when they manage several. Both
// are bound to the store and the staff member who started.

export const SOCIAL_PAGE = "/admin/social";
export const CALLBACK_PATH = "/api/v1/admin/social/meta/callback";

const STATE_COOKIE = "meta_oauth";
const PENDING_COOKIE = "meta_pending";
const STATE_PURPOSE = "social.meta.oauth-state";
const PENDING_PURPOSE = "social.meta.pending-user-token";
const STATE_MINUTES = 10;
const PENDING_MINUTES = 15;

const globals = globalThis as typeof globalThis & { __metaGraph?: MetaGraph | null };

/** Whether the Meta app's keys are set; without them the social screens explain what is missing. */
export function metaConfigured(): boolean {
  const env = getEnv();
  return Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_WEBHOOK_VERIFY_TOKEN);
}

export function getMetaGraph(): MetaGraph | null {
  if (globals.__metaGraph !== undefined) return globals.__metaGraph;
  const env = getEnv();
  if (!metaConfigured()) {
    globals.__metaGraph = null;
  } else if (env.META_GRAPH_MODE === "fake") {
    globals.__metaGraph = createFakeMetaGraph();
  } else {
    globals.__metaGraph = createMetaGraph({
      appId: env.META_APP_ID!,
      appSecret: env.META_APP_SECRET!,
      version: env.META_GRAPH_VERSION,
      loginConfigId: env.META_LOGIN_CONFIG_ID,
    });
  }
  return globals.__metaGraph;
}

export function redirectUri(): string {
  return new URL(CALLBACK_PATH, getEnv().APP_URL).toString();
}

interface Bound {
  tenantId: string;
  userId: string;
  expiresAt: number;
}

const secure = () => new URL(getEnv().APP_URL).protocol === "https:";

function seal(purpose: string, value: object): string {
  return sealSecret(getEnv().ENCRYPTION_KEY, purpose, JSON.stringify(value));
}

function open<T extends Bound>(
  purpose: string,
  sealed: string | undefined,
  context: RequestContext,
): T | null {
  if (!sealed) return null;
  const plain = openSecret(getEnv().ENCRYPTION_KEY, purpose, sealed);
  if (!plain) return null;
  try {
    const value = JSON.parse(plain) as T;
    if (value.tenantId !== context.tenantId || value.userId !== context.userId) return null;
    if (typeof value.expiresAt !== "number" || value.expiresAt < Date.now()) return null;
    return value;
  } catch {
    return null;
  }
}

/** Starts a sign-in: remembers a fresh state and returns Meta's sign-in address. */
export async function beginMetaSignIn(context: RequestContext, graph: MetaGraph): Promise<string> {
  const state = randomBytes(24).toString("base64url");
  const jar = await cookies();
  jar.set(
    STATE_COOKIE,
    seal(STATE_PURPOSE, {
      state,
      tenantId: context.tenantId,
      userId: context.userId,
      expiresAt: Date.now() + STATE_MINUTES * 60_000,
    }),
    {
      httpOnly: true,
      // Lax: the cookie must come back on Meta's top-level redirect.
      sameSite: "lax",
      secure: secure(),
      path: CALLBACK_PATH,
      maxAge: STATE_MINUTES * 60,
    },
  );
  return graph.loginUrl({ redirectUri: redirectUri(), state });
}

/** Whether the state Meta sent back is the one this person's sign-in started with (used once). */
export async function checkMetaState(context: RequestContext, given: string): Promise<boolean> {
  const jar = await cookies();
  const saved = open<Bound & { state: string }>(
    STATE_PURPOSE,
    jar.get(STATE_COOKIE)?.value,
    context,
  );
  jar.delete({ name: STATE_COOKIE, path: CALLBACK_PATH });
  if (!saved || typeof saved.state !== "string") return false;
  const a = Buffer.from(saved.state);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function keepPendingToken(context: RequestContext, userToken: string): Promise<void> {
  (await cookies()).set(
    PENDING_COOKIE,
    seal(PENDING_PURPOSE, {
      token: userToken,
      tenantId: context.tenantId,
      userId: context.userId,
      expiresAt: Date.now() + PENDING_MINUTES * 60_000,
    }),
    {
      httpOnly: true,
      // Lax: it is set during Meta's redirect chain and read on the page it lands on.
      sameSite: "lax",
      secure: secure(),
      path: SOCIAL_PAGE,
      maxAge: PENDING_MINUTES * 60,
    },
  );
}

export async function pendingToken(context: RequestContext): Promise<string | null> {
  const value = open<Bound & { token: string }>(
    PENDING_PURPOSE,
    (await cookies()).get(PENDING_COOKIE)?.value,
    context,
  );
  return value && typeof value.token === "string" ? value.token : null;
}

export async function clearPendingToken(): Promise<void> {
  (await cookies()).delete({ name: PENDING_COOKIE, path: SOCIAL_PAGE });
}
