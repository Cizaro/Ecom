import type { Env } from "@ecom/config";
import type { AdminPrismaClient } from "@ecom/db";
import { betterAuth, type BetterAuthPlugin } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";
import type { EmailProvider } from "../notifications/email";
import type { Logger } from "../platform/logger";
import { hashPassword, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, verifyPassword } from "./password";

export const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;
export const RESET_TOKEN_LIFETIME_SECONDS = 60 * 30;
export const RESET_PASSWORD_PATH = "/admin/reset-password";

export interface AuthDependencies {
  /** Admin connection: the runtime role has no access to the auth tables. */
  prisma: AdminPrismaClient;
  env: Pick<Env, "APP_URL" | "AUTH_SECRET">;
  email: EmailProvider;
  logger: Logger;
  /** Framework plugins, for example Next.js cookie handling. */
  plugins?: BetterAuthPlugin[];
}

/**
 * Configures the Better Auth library for staff sign-in. Nothing here is exposed
 * over HTTP directly: the web app calls it through AuthService from server
 * actions, so there is no public sign-up or auth API surface.
 */
export function createAuth({ prisma, env, email, logger, plugins = [] }: AuthDependencies) {
  return betterAuth({
    appName: "Store Admin",
    baseURL: env.APP_URL,
    secret: env.AUTH_SECRET,
    database: prismaAdapter(prisma, { provider: "postgresql" }),
    telemetry: { enabled: false },
    logger: {
      level: "warn",
      log: (level, message) =>
        logger[level === "debug" ? "debug" : level]({ source: "auth" }, message),
    },

    emailAndPassword: {
      enabled: true,
      // Staff accounts are created by an owner or the admin:create command.
      disableSignUp: true,
      minPasswordLength: PASSWORD_MIN_LENGTH,
      maxPasswordLength: PASSWORD_MAX_LENGTH,
      resetPasswordTokenExpiresIn: RESET_TOKEN_LIFETIME_SECONDS,
      revokeSessionsOnPasswordReset: true,
      password: {
        hash: hashPassword,
        verify: ({ hash, password }) => verifyPassword(hash, password),
      },
      sendResetPassword: async ({ user, token }) => {
        const url = new URL(RESET_PASSWORD_PATH, env.APP_URL);
        url.searchParams.set("token", token);
        await email.send({
          to: user.email,
          subject: "Reset your password",
          text: [
            "Someone asked to reset the password for this account.",
            "",
            `Open this link to choose a new password: ${url.toString()}`,
            "",
            `The link works once and expires in ${RESET_TOKEN_LIFETIME_SECONDS / 60} minutes.`,
            "If you did not ask for this, you can ignore this email; your password has not changed.",
          ].join("\n"),
        });
      },
    },

    session: {
      expiresIn: SESSION_LIFETIME_SECONDS,
      updateAge: 60 * 60 * 24,
      // No cookie cache: every request checks the database, so revoking a
      // session takes effect immediately.
      cookieCache: { enabled: false },
    },

    advanced: {
      cookiePrefix: "ecom",
      useSecureCookies: env.APP_URL.startsWith("https://"),
      // Prisma generates UUID v7 primary keys.
      database: { generateId: false },
    },

    databaseHooks: {
      session: {
        create: {
          // Disabled or deleted users cannot get a session, whatever their password.
          before: async (session) => {
            const user = await prisma.user.findUnique({
              where: { id: session.userId },
              select: { status: true, deletedAt: true },
            });
            if (!user || user.status !== "active" || user.deletedAt) {
              throw new APIError("FORBIDDEN", { message: "Account is disabled" });
            }
          },
        },
      },
    },

    plugins: [twoFactor({ issuer: "Store Admin" }), ...plugins],
  });
}

export type Auth = ReturnType<typeof createAuth>;
