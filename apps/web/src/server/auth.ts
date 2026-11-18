import "server-only";

import { getEnv } from "@ecom/config";
import {
  createAuth,
  createAuthService,
  createEmailProvider,
  createLogger,
  createRedisRateLimiter,
  type AuthService,
  type CurrentSession,
  type RequestInfo,
} from "@ecom/core";
import { getAdminPrisma } from "@ecom/db";
import { nextCookies } from "better-auth/next-js";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { clientAddressFrom } from "./client-address";

export const SIGN_IN_PATH = "/admin/sign-in";

// Kept on globalThis so development hot reloads do not open new connections.
const globalForAuth = globalThis as typeof globalThis & { __authService?: AuthService };

export function getAuthService(): AuthService {
  if (!globalForAuth.__authService) {
    const env = getEnv();
    const logger = createLogger("web", env.LOG_LEVEL);
    // Authentication is the one part of request handling that uses the admin
    // database connection: the runtime role cannot read credentials or sessions.
    const prisma = getAdminPrisma(env.DATABASE_ADMIN_URL);
    const auth = createAuth({
      prisma,
      env,
      logger,
      email: createEmailProvider(env, logger),
      // Lets the library set cookies from server actions. Must be the last plugin.
      plugins: [nextCookies()],
    });
    globalForAuth.__authService = createAuthService({
      auth,
      prisma,
      logger,
      limiter: createRedisRateLimiter(env.REDIS_URL),
    });
  }
  return globalForAuth.__authService;
}

/**
 * Client address for rate limiting and the audit log: the X-Forwarded-For
 * entry added by our own proxies (TRUST_PROXY_HOPS), which a visitor cannot
 * forge. See client-address.ts.
 */
function clientIp(requestHeaders: Headers): string {
  return clientAddressFrom(requestHeaders.get("x-forwarded-for"), getEnv().TRUST_PROXY_HOPS);
}

export async function getRequestInfo(): Promise<RequestInfo> {
  const requestHeaders = new Headers(await headers());
  return { headers: requestHeaders, ip: clientIp(requestHeaders) };
}

/** The signed-in staff user for this request, or null. Checked once per request. */
export const getCurrentSession = cache(async (): Promise<CurrentSession | null> => {
  return getAuthService().getSession(new Headers(await headers()));
});

/** For protected pages and actions: redirects to sign-in when there is no session. */
export async function requireSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect(SIGN_IN_PATH);
  return session;
}
