"use server";

import { getEnv } from "@ecom/config";
import { PlatformError, signUpShop } from "@ecom/core";
import { redirect } from "next/navigation";
import { getAuthService, getRequestInfo } from "@/server/auth";
import { tooManyAttempts } from "@/server/limits";
import { requirePlatformSite } from "@/server/platform-site";

// Self-service sign-up (D121): creates the owner's account and a shop on a
// free trial, signs them in on the platform's host and opens their admin.

export interface SignUpState {
  error?: string;
  field?: string;
  /** What the visitor typed, to show again after a problem. Never the password. */
  values?: Record<string, string>;
}

const FIELDS = ["name", "email", "shopName", "address", "template", "acceptTerms"] as const;

const field = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function signUpShopAction(
  _previous: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  await requirePlatformSite();
  const values = Object.fromEntries(FIELDS.map((n) => [n, field(formData, n)])) as Record<
    (typeof FIELDS)[number],
    string
  >;
  const password = field(formData, "password");
  // A few sign-ups per address per hour: enough for a family sharing a
  // connection, too few to fill the platform with junk shops.
  if (await tooManyAttempts("platform", "signup")) {
    return { error: "Too many sign-ups from this connection. Try again in an hour.", values };
  }
  const env = getEnv();
  const info = await getRequestInfo();
  let email: string;
  try {
    const shop = await signUpShop(
      env.DATABASE_ADMIN_URL,
      { ...values, password },
      { suffix: env.SHOP_ADDRESS_SUFFIX, platformHost: env.PLATFORM_HOST, ip: info.ip },
    );
    email = shop.email;
  } catch (error) {
    if (error instanceof PlatformError) {
      return { error: error.message, ...(error.field ? { field: error.field } : {}), values };
    }
    throw error;
  }
  const result = await getAuthService().signIn({ email, password, ...info });
  if (result.status === "signed_in") redirect("/admin?welcome=1");
  // Should not happen for a brand-new account; the shop exists, so sign in by hand.
  redirect("/admin/sign-in");
}
