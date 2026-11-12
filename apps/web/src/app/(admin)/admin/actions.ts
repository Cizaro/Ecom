"use server";

import { PASSWORD_MIN_LENGTH } from "@ecom/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAuthService, getRequestInfo, requireSession, SIGN_IN_PATH } from "@/server/auth";

// Server actions for staff authentication. Next.js rejects cross-origin calls
// to server actions, which is the CSRF protection for these forms.

export interface FormState {
  error?: string;
  notice?: string;
}

export interface TwoFactorSetupState extends FormState {
  setup?: { secret: string; totpUri: string; backupCodes: string[] };
}

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

export async function signInAction(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = text(formData, "email");
  const password = text(formData, "password");
  if (!email || !password) return { error: "Enter your email and password." };

  const result = await getAuthService().signIn({ email, password, ...(await getRequestInfo()) });

  if (result.status === "signed_in") redirect("/admin");
  if (result.status === "two_factor_required") redirect("/admin/two-factor");
  if (result.status === "locked") {
    const minutes = Math.max(1, Math.ceil(result.retryAfterSeconds / 60));
    return { error: `Too many attempts. Try again in about ${minutes} minutes.` };
  }
  return { error: "Email or password is incorrect." };
}

export async function verifySecondFactorAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const code = text(formData, "code").trim();
  const kind = text(formData, "kind") === "backup" ? "backup" : "totp";
  if (!code) return { error: "Enter a code." };

  const result = await getAuthService().verifySecondFactor({
    code,
    kind,
    ...(await getRequestInfo()),
  });

  if (result.status === "signed_in") redirect("/admin");
  if (result.status === "locked") return { error: "Too many attempts. Try again later." };
  return { error: "That code is not valid. Check it and try again, or sign in again." };
}

export async function signOutAction(): Promise<void> {
  await getAuthService().signOut(await getRequestInfo());
  redirect(SIGN_IN_PATH);
}

export async function signOutEverywhereAction(): Promise<void> {
  await getAuthService().signOutEverywhere(await getRequestInfo());
  redirect(SIGN_IN_PATH);
}

export async function requestPasswordResetAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = text(formData, "email");
  if (!email) return { error: "Enter your email address." };

  const { ip } = await getRequestInfo();
  await getAuthService().requestPasswordReset({ email, ip });

  // Deliberately the same message whether or not the account exists.
  return {
    notice: "If an account exists for that address, we have sent a link to reset the password.",
  };
}

export async function resetPasswordAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const token = text(formData, "token");
  const newPassword = text(formData, "password");
  const confirmation = text(formData, "confirmation");
  if (newPassword !== confirmation) return { error: "The two passwords do not match." };
  if (newPassword.length < PASSWORD_MIN_LENGTH) {
    return { error: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }

  const { ip } = await getRequestInfo();
  const result = await getAuthService().resetPassword({ token, newPassword, ip });

  if (result.status === "ok") redirect(`${SIGN_IN_PATH}?reset=1`);
  if (result.status === "weak_password") return { error: result.problem };
  return { error: "This reset link is invalid or has expired. Request a new one." };
}

export async function beginTwoFactorSetupAction(
  _previous: TwoFactorSetupState,
  formData: FormData,
): Promise<TwoFactorSetupState> {
  await requireSession();
  const result = await getAuthService().beginTwoFactorSetup({
    password: text(formData, "password"),
    ...(await getRequestInfo()),
  });
  if (result.status === "ok") {
    return {
      setup: { secret: result.secret, totpUri: result.totpUri, backupCodes: result.backupCodes },
    };
  }
  if (result.status === "already_enabled") {
    return { error: "Two-factor authentication is already on." };
  }
  return { error: "Password is incorrect." };
}

export async function confirmTwoFactorSetupAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const result = await getAuthService().confirmTwoFactorSetup({
    code: text(formData, "code"),
    ...(await getRequestInfo()),
  });
  if (!result.ok)
    return { error: "That code is not valid. Check the time on your phone and retry." };
  revalidatePath("/admin/account/security");
  redirect("/admin/account/security?enabled=1");
}

export async function disableTwoFactorAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();
  const result = await getAuthService().disableTwoFactor({
    password: text(formData, "password"),
    ...(await getRequestInfo()),
  });
  if (result.required) {
    return { error: "Your store requires two-factor authentication for your role." };
  }
  if (!result.ok) return { error: "Password is incorrect." };
  revalidatePath("/admin/account/security");
  redirect("/admin/account/security?disabled=1");
}
