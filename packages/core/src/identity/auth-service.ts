import { createHash } from "node:crypto";
import type { AdminPrismaClient } from "@ecom/db";
import type { Logger } from "../platform/logger";
import type { RateLimiter, RateLimitRule } from "../platform/rate-limit";
import type { Auth } from "./auth";
import { passwordProblem } from "./password";

// Lockout rules. Failures are counted per account and per client address.
const SIGN_IN_PER_EMAIL: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 };
const SIGN_IN_PER_IP: RateLimitRule = { limit: 30, windowSeconds: 15 * 60 };
const RESET_PER_EMAIL: RateLimitRule = { limit: 3, windowSeconds: 60 * 60 };
const RESET_PER_IP: RateLimitRule = { limit: 10, windowSeconds: 60 * 60 };
const SECOND_FACTOR_PER_IP: RateLimitRule = { limit: 10, windowSeconds: 15 * 60 };

export interface RequestInfo {
  /** Request headers, including cookies. */
  headers: Headers;
  /** Client address, used for rate limits and the audit log. */
  ip: string;
}

export interface SessionMembership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  roleKey: string;
  roleName: string;
}

export interface CurrentSession {
  sessionId: string;
  user: {
    id: string;
    email: string;
    name: string;
    twoFactorEnabled: boolean;
    isPlatformAdmin: boolean;
  };
  memberships: SessionMembership[];
}

/** `setCookies` is for callers outside Next.js (tests); Next sets cookies itself. */
interface WithCookies {
  setCookies: string[];
}

export type SignInResult = WithCookies &
  (
    | { status: "signed_in" }
    | { status: "two_factor_required" }
    | { status: "invalid_credentials" }
    | { status: "locked"; retryAfterSeconds: number }
  );

export type SecondFactorResult = WithCookies &
  ({ status: "signed_in" } | { status: "invalid_code" } | { status: "locked" });

export type ResetPasswordResult =
  { status: "ok" } | { status: "invalid_token" } | { status: "weak_password"; problem: string };

export type BeginTwoFactorResult =
  | { status: "ok"; totpUri: string; secret: string; backupCodes: string[] }
  | { status: "invalid_password" }
  | { status: "already_enabled" };

export interface AuthService {
  signIn(input: { email: string; password: string } & RequestInfo): Promise<SignInResult>;
  verifySecondFactor(
    input: { code: string; kind: "totp" | "backup" } & RequestInfo,
  ): Promise<SecondFactorResult>;
  signOut(input: RequestInfo): Promise<WithCookies>;
  signOutEverywhere(input: RequestInfo): Promise<void>;
  getSession(headers: Headers): Promise<CurrentSession | null>;
  requestPasswordReset(input: { email: string; ip: string }): Promise<void>;
  resetPassword(input: {
    token: string;
    newPassword: string;
    ip: string;
  }): Promise<ResetPasswordResult>;
  beginTwoFactorSetup(input: { password: string } & RequestInfo): Promise<BeginTwoFactorResult>;
  confirmTwoFactorSetup(
    input: { code: string } & RequestInfo,
  ): Promise<{ ok: boolean } & WithCookies>;
  disableTwoFactor(
    input: { password: string } & RequestInfo,
  ): Promise<{ ok: boolean } & WithCookies>;
}

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const emailKey = (email: string) =>
  createHash("sha256").update(normalizeEmail(email)).digest("hex").slice(0, 32);

function errorCode(error: unknown): string {
  if (error && typeof error === "object") {
    const body = (error as { body?: { code?: unknown } }).body;
    if (typeof body?.code === "string") return body.code;
    const status = (error as { status?: unknown }).status;
    if (typeof status === "string") return status;
  }
  return "UNKNOWN";
}

const isAuthError = (error: unknown) =>
  error instanceof Error && (error.name === "APIError" || "statusCode" in error);

export function createAuthService(deps: {
  auth: Auth;
  prisma: AdminPrismaClient;
  limiter: RateLimiter;
  logger: Logger;
}): AuthService {
  const { auth, prisma, limiter, logger } = deps;

  async function audit(
    action: string,
    ip: string,
    userId: string | null,
    detail?: Record<string, string | number | boolean>,
  ) {
    try {
      await prisma.auditLog.create({
        data: {
          tenantId: null,
          actorType: userId ? "user" : "anonymous",
          actorUserId: userId,
          action,
          entityType: "user",
          entityId: userId,
          ip,
          ...(detail ? { after: detail } : {}),
        },
      });
    } catch (error) {
      // An audit failure must not turn a completed sign-out into an error, but
      // it must be loud.
      logger.error({ action, err: (error as Error).message }, "audit log write failed");
    }
  }

  async function userIdForEmail(email: string): Promise<string | null> {
    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: { id: true },
    });
    return user?.id ?? null;
  }

  async function sessionUserId(headers: Headers): Promise<string | null> {
    const session = await auth.api.getSession({ headers });
    return session?.user.id ?? null;
  }

  return {
    async signIn({ email, password, headers, ip }) {
      const perEmail = `signin:email:${emailKey(email)}`;
      const perIp = `signin:ip:${ip}`;

      const [emailStatus, ipStatus] = await Promise.all([
        limiter.check(perEmail, SIGN_IN_PER_EMAIL),
        limiter.check(perIp, SIGN_IN_PER_IP),
      ]);
      if (emailStatus.blocked || ipStatus.blocked) {
        await audit("auth.sign_in_blocked", ip, await userIdForEmail(email));
        return {
          status: "locked",
          retryAfterSeconds: Math.max(
            emailStatus.blocked ? emailStatus.retryAfterSeconds : 0,
            ipStatus.blocked ? ipStatus.retryAfterSeconds : 0,
          ),
          setCookies: [],
        };
      }

      try {
        const result = await auth.api.signInEmail({
          body: { email: normalizeEmail(email), password },
          headers,
          returnHeaders: true,
        });
        const setCookies = result.headers.getSetCookie();
        await limiter.reset(perEmail);

        if ("twoFactorRedirect" in result.response) {
          // The password was right; the session starts only after the second factor.
          await audit("auth.password_accepted", ip, await userIdForEmail(email));
          return { status: "two_factor_required", setCookies };
        }
        await audit("auth.sign_in", ip, result.response.user.id);
        return { status: "signed_in", setCookies };
      } catch (error) {
        if (!isAuthError(error)) throw error;
        await Promise.all([
          limiter.hit(perEmail, SIGN_IN_PER_EMAIL),
          limiter.hit(perIp, SIGN_IN_PER_IP),
        ]);
        // Same answer whether the account exists, is disabled, or the password is wrong.
        await audit("auth.sign_in_failed", ip, await userIdForEmail(email), {
          reason: errorCode(error),
        });
        return { status: "invalid_credentials", setCookies: [] };
      }
    },

    async verifySecondFactor({ code, kind, headers, ip }) {
      const perIp = `second-factor:ip:${ip}`;
      if ((await limiter.check(perIp, SECOND_FACTOR_PER_IP)).blocked) {
        return { status: "locked", setCookies: [] };
      }
      try {
        const body = { code: code.replace(/\s+/g, "") };
        const result =
          kind === "totp"
            ? await auth.api.verifyTOTP({ body, headers, returnHeaders: true })
            : await auth.api.verifyBackupCode({ body, headers, returnHeaders: true });
        const userId = (result.response as { user?: { id?: string } }).user?.id ?? null;
        await audit(kind === "totp" ? "auth.sign_in" : "auth.sign_in_backup_code", ip, userId, {
          secondFactor: kind,
        });
        return { status: "signed_in", setCookies: result.headers.getSetCookie() };
      } catch (error) {
        if (!isAuthError(error)) throw error;
        await limiter.hit(perIp, SECOND_FACTOR_PER_IP);
        await audit("auth.second_factor_failed", ip, null, { reason: errorCode(error), kind });
        return { status: "invalid_code", setCookies: [] };
      }
    },

    async signOut({ headers, ip }) {
      const userId = await sessionUserId(headers);
      const result = await auth.api.signOut({ headers, returnHeaders: true });
      if (userId) await audit("auth.sign_out", ip, userId);
      return { setCookies: result.headers.getSetCookie() };
    },

    async signOutEverywhere({ headers, ip }) {
      const userId = await sessionUserId(headers);
      if (!userId) return;
      await auth.api.revokeSessions({ headers });
      await audit("auth.sign_out_everywhere", ip, userId);
    },

    async getSession(headers) {
      const session = await auth.api.getSession({ headers });
      if (!session) return null;

      const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
          id: true,
          email: true,
          name: true,
          status: true,
          deletedAt: true,
          twoFactorEnabled: true,
          isPlatformAdmin: true,
          memberships: {
            where: { status: "active", tenant: { status: "active" } },
            select: {
              tenant: { select: { id: true, slug: true, name: true } },
              role: { select: { key: true, name: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      });
      // A user disabled after signing in loses access on the next request.
      if (!user || user.status !== "active" || user.deletedAt) return null;

      return {
        sessionId: session.session.id,
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          twoFactorEnabled: user.twoFactorEnabled,
          isPlatformAdmin: user.isPlatformAdmin,
        },
        memberships: user.memberships.map((membership) => ({
          tenantId: membership.tenant.id,
          tenantSlug: membership.tenant.slug,
          tenantName: membership.tenant.name,
          roleKey: membership.role.key,
          roleName: membership.role.name,
        })),
      };
    },

    async requestPasswordReset({ email, ip }) {
      const [perEmail, perIp] = await Promise.all([
        limiter.hit(`reset:email:${emailKey(email)}`, RESET_PER_EMAIL),
        limiter.hit(`reset:ip:${ip}`, RESET_PER_IP),
      ]);
      // Over the limit: stay silent, exactly as for an unknown address.
      if (perEmail.count > RESET_PER_EMAIL.limit || perIp.count > RESET_PER_IP.limit) return;

      const userId = await userIdForEmail(email);
      try {
        await auth.api.requestPasswordReset({ body: { email: normalizeEmail(email) } });
      } catch (error) {
        if (!isAuthError(error)) throw error;
        logger.warn({ code: errorCode(error) }, "password reset request rejected");
      }
      await audit("auth.password_reset_requested", ip, userId);
    },

    async resetPassword({ token, newPassword, ip }) {
      const problem = passwordProblem(newPassword);
      if (problem) return { status: "weak_password", problem };
      try {
        await auth.api.resetPassword({ body: { token, newPassword } });
      } catch (error) {
        if (!isAuthError(error)) throw error;
        await audit("auth.password_reset_failed", ip, null, { reason: errorCode(error) });
        return { status: "invalid_token" };
      }
      await audit("auth.password_reset", ip, null);
      return { status: "ok" };
    },

    async beginTwoFactorSetup({ password, headers, ip }) {
      const userId = await sessionUserId(headers);
      if (!userId) return { status: "invalid_password" };
      try {
        const result = await auth.api.enableTwoFactor({ body: { password }, headers });
        if (!("totpURI" in result)) return { status: "invalid_password" };
        const secret = new URL(result.totpURI).searchParams.get("secret") ?? "";
        await audit("auth.two_factor_setup_started", ip, userId);
        return { status: "ok", totpUri: result.totpURI, secret, backupCodes: result.backupCodes };
      } catch (error) {
        if (!isAuthError(error)) throw error;
        return errorCode(error) === "TOTP_ALREADY_ENABLED"
          ? { status: "already_enabled" }
          : { status: "invalid_password" };
      }
    },

    async confirmTwoFactorSetup({ code, headers, ip }) {
      const userId = await sessionUserId(headers);
      if (!userId) return { ok: false, setCookies: [] };
      let setCookies: string[];
      try {
        // The library replaces the session when two-factor is switched on, so
        // the new cookies must reach the caller.
        const result = await auth.api.verifyTOTP({
          body: { code: code.replace(/\s+/g, "") },
          headers,
          returnHeaders: true,
        });
        setCookies = result.headers.getSetCookie();
      } catch (error) {
        if (!isAuthError(error)) throw error;
        return { ok: false, setCookies: [] };
      }
      await audit("auth.two_factor_enabled", ip, userId);
      return { ok: true, setCookies };
    },

    async disableTwoFactor({ password, headers, ip }) {
      const userId = await sessionUserId(headers);
      if (!userId) return { ok: false, setCookies: [] };
      let setCookies: string[];
      try {
        const result = await auth.api.disableTwoFactor({
          body: { password },
          headers,
          returnHeaders: true,
        });
        setCookies = result.headers.getSetCookie();
      } catch (error) {
        if (!isAuthError(error)) throw error;
        return { ok: false, setCookies: [] };
      }
      await audit("auth.two_factor_disabled", ip, userId);
      return { ok: true, setCookies };
    },
  };
}
