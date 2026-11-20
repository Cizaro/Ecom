import { getAdminPrisma } from "@ecom/db";
import { hashPassword, passwordProblem } from "../identity/password";
import { BRANDING_PRESETS, DEFAULT_BRANDING } from "../tenancy/branding";
import { normalizeHost } from "../tenancy/store-host";
import { recordAudit } from "./audit";
import { PlatformError } from "./shops";

// Self-service sign-up on the platform site (decision D121): a shop owner
// creates their account and a shop on a free trial, with a ready-made look,
// at <name>.<SHOP_ADDRESS_SUFFIX>. Platform-level by nature (a new tenant
// and a new user), so it uses the admin connection, like createShop.

export const TRIAL_DAYS = 14;

/** The ready-made shop looks offered at sign-up (each is a set of colours, corners and font). */
export const SHOP_TEMPLATES = [
  {
    key: "classic",
    name: "Classic",
    description: "Dark and gold, clean lines. Suits bags, watches and jewellery.",
  },
  {
    key: "boutique",
    name: "Boutique",
    description: "Plum with an elegant serif font and sharp corners. Suits fashion.",
  },
  {
    key: "fresh",
    name: "Fresh",
    description: "Green with rounded shapes and a friendly font. Suits beauty and home.",
  },
  {
    key: "ocean",
    name: "Ocean",
    description: "Navy and blue, calm and trustworthy. Suits electronics and gifts.",
  },
].map((template) => {
  const preset = BRANDING_PRESETS.find((p) => p.key === template.key)!;
  return { ...template, branding: { ...DEFAULT_BRANDING, ...preset.branding } };
});

/** Addresses no shop may take: they belong to the platform itself or would confuse visitors. */
const RESERVED = new Set([
  "www",
  "admin",
  "api",
  "app",
  "platform",
  "mail",
  "email",
  "smtp",
  "help",
  "support",
  "status",
  "docs",
  "blog",
  "billing",
  "static",
  "cdn",
  "media",
  "assets",
  "dashboard",
  "login",
  "signup",
  "shop",
  "store",
  "test",
]);

const SHOP_NAME = /^[a-z0-9]([a-z0-9-]{1,28}[a-z0-9])$/;

/** The problem with a wanted shop address name, or null when it can be used. */
export function shopNameProblem(name: string): string | null {
  if (!SHOP_NAME.test(name) || name.includes("--")) {
    return "Use 3 to 30 lower-case letters, digits and single dashes, e.g. tamara-bags.";
  }
  if (RESERVED.has(name)) return "That address is reserved. Choose another.";
  return null;
}

export interface ShopSignUpInput {
  name: unknown;
  email: unknown;
  password: unknown;
  shopName: unknown;
  address: unknown;
  template: unknown;
  acceptTerms: unknown;
}

export interface ShopSignUpOptions {
  /** e.g. "yourplatform.com"; the shop answers on <address>.<suffix>. */
  suffix: string;
  /** The platform site's own host: never given to a shop. */
  platformHost: string;
  ip?: string | null;
  now?: Date;
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Creates the owner's account and their shop on a free trial. The address,
 * the email and the password are checked before anything is written; the
 * rest happens in one transaction, so a failure leaves nothing behind.
 * Throws PlatformError (with the form field) for anything the visitor can fix.
 */
export async function signUpShop(
  adminUrl: string,
  input: ShopSignUpInput,
  options: ShopSignUpOptions,
): Promise<{ tenantId: string; email: string; hostname: string; trialEndsAt: Date }> {
  const ownerName = text(input.name).replace(/\s+/g, " ").slice(0, 100);
  if (!ownerName) throw new PlatformError("Enter your name.", "name");
  const email = text(input.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new PlatformError("Enter your email address.", "email");
  }
  const password = typeof input.password === "string" ? input.password : "";
  const weak = passwordProblem(password);
  if (weak) throw new PlatformError(weak, "password");
  const shopName = text(input.shopName).replace(/\s+/g, " ");
  if (!shopName || shopName.length > 80) {
    throw new PlatformError("Give your shop a name (80 characters at most).", "shopName");
  }
  const address = text(input.address).toLowerCase();
  const addressProblem = shopNameProblem(address);
  if (addressProblem) throw new PlatformError(addressProblem, "address");
  const hostname = normalizeHost(`${address}.${options.suffix}`);
  if (!hostname || hostname === options.platformHost.toLowerCase()) {
    throw new PlatformError("That address is reserved. Choose another.", "address");
  }
  const template = SHOP_TEMPLATES.find((t) => t.key === text(input.template));
  if (!template) throw new PlatformError("Choose a design for your shop.", "template");
  if (input.acceptTerms !== true && input.acceptTerms !== "on") {
    throw new PlatformError("Please accept the terms to continue.", "acceptTerms");
  }

  const db = getAdminPrisma(adminUrl);
  if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
    throw new PlatformError(
      "There is already an account with this email. Sign in instead, or use another email.",
      "email",
    );
  }
  if (
    (await db.tenant.findUnique({ where: { slug: address }, select: { id: true } })) ||
    (await db.storeDomain.findUnique({ where: { hostname }, select: { id: true } }))
  ) {
    throw new PlatformError("That address is taken. Choose another.", "address");
  }

  const passwordHash = await hashPassword(password);
  const now = options.now ?? new Date();
  const trialEndsAt = new Date(now.getTime() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  try {
    return await db.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: shopName,
          slug: address,
          plan: "trial",
          trialEndsAt,
          stores: {
            create: [
              {
                name: shopName,
                slug: "main",
                defaultCurrency: "USD",
                timezone: "Asia/Beirut",
                branding: { ...template.branding, contactEmail: email },
              },
            ],
          },
        },
        select: { id: true, stores: { select: { id: true }, take: 1 } },
      });
      await tx.storeDomain.create({
        data: {
          tenantId: tenant.id,
          storeId: tenant.stores[0]!.id,
          hostname,
          isPrimary: true,
        },
      });
      const user = await tx.user.create({
        data: { email, name: ownerName, emailVerified: false },
        select: { id: true },
      });
      await tx.account.create({
        data: {
          userId: user.id,
          providerId: "credential",
          accountId: user.id,
          password: passwordHash,
        },
      });
      const role = await tx.role.findFirstOrThrow({
        where: { tenantId: null, key: "store_owner" },
        select: { id: true },
      });
      await tx.userTenantMembership.create({
        data: { userId: user.id, tenantId: tenant.id, roleId: role.id },
      });
      await recordAudit(tx, {
        tenantId: tenant.id,
        actorType: "user",
        actorUserId: user.id,
        action: "platform.signup",
        entityType: "tenant",
        entityId: tenant.id,
        after: {
          shopName,
          hostname,
          template: template.key,
          plan: "trial",
          trialEndsAt: trialEndsAt.toISOString(),
        },
        ip: options.ip ?? null,
      });
      return { tenantId: tenant.id, email, hostname, trialEndsAt };
    });
  } catch (error) {
    // Two sign-ups racing for the same address or email: the database's
    // unique rules refuse the second one.
    if (error && typeof error === "object" && (error as { code?: string }).code === "P2002") {
      throw new PlatformError("That address or email was just taken. Try another.", "address");
    }
    throw error;
  }
}
