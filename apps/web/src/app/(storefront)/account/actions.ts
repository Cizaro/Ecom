"use server";

import {
  claimCartForCustomer,
  createAddress,
  CustomerError,
  deleteAddress,
  requestPasswordReset,
  resetPassword,
  setDefaultAddress,
  setMarketingConsent,
  signInCustomer,
  signOutCustomer,
  signUpCustomer,
  updateAddress,
  updateCustomerProfile,
  verifyCustomerEmail,
  type AddressInput,
} from "@ecom/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { readCartToken } from "@/server/cart";
import {
  clearCartCookie,
  clearCustomerSession,
  customerDeps,
  customerRequest,
  readCustomerSessionToken,
  requireCustomer,
  safeReturnPath,
  writeCustomerSession,
} from "@/server/customer";
import { storefrontDb } from "@/server/storefront";

// Account actions for shoppers. No staff sign-in is involved: every action
// finds its store from the host name (storefrontDb), and every action on an
// account takes the customer from their own session cookie (requireCustomer),
// never from the form. Next.js rejects cross-site POSTs to server actions,
// which is the CSRF protection for these forms.

export interface AccountFormState {
  error?: string;
  notice?: string;
  /** What was typed, to show again after a refused submit. Never passwords. */
  values?: Record<string, string>;
}

const text = (formData: FormData, name: string): string => {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
};

const keep = (formData: FormData, names: readonly string[]): Record<string, string> =>
  Object.fromEntries(names.map((name) => [name, text(formData, name)]));

/** Turns a refusal the customer can act on into a form message. Anything else is a real error. */
async function attempt(
  work: () => Promise<AccountFormState>,
  values?: Record<string, string>,
): Promise<AccountFormState> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof CustomerError) return { error: error.message, values };
    throw error;
  }
}

/** Signs the browser in and moves any guest cart into the account. */
async function startSession(
  db: Awaited<ReturnType<typeof storefrontDb>>["db"],
  sessionToken: string,
  customerId: string,
) {
  await writeCustomerSession(sessionToken);
  const guestCart = await readCartToken();
  if (guestCart) {
    await claimCartForCustomer(db, guestCart, customerId);
    await clearCartCookie();
  }
  revalidatePath("/", "layout");
}

// --- Without an account --------------------------------------------------------

export async function signUpAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const values = keep(formData, ["email", "name", "marketing"]);
  return attempt(async () => {
    await signUpCustomer(db, await customerDeps(), await customerRequest(), {
      email: text(formData, "email"),
      password: text(formData, "password"),
      name: text(formData, "name"),
      marketingConsent: formData.get("marketing") === "on",
    });
    // The same answer whether or not the address already had an account.
    return {
      notice:
        "Thank you. We have sent an email to that address. Open the link in it to finish creating your account.",
    };
  }, values);
}

export async function verifyEmailAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const result = await attempt(async () => {
    const { sessionToken, customerId } = await verifyCustomerEmail(
      db,
      await customerRequest(),
      text(formData, "token"),
    );
    await startSession(db, sessionToken, customerId);
    return {};
  });
  if (result.error) return result;
  redirect("/account?welcome=1");
}

export async function signInAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const values = keep(formData, ["email"]);
  const result = await attempt(async () => {
    const { sessionToken, customerId } = await signInCustomer(
      db,
      await customerDeps(),
      await customerRequest(),
      { email: text(formData, "email"), password: text(formData, "password") },
    );
    await startSession(db, sessionToken, customerId);
    return {};
  }, values);
  if (result.error) return result;
  redirect(safeReturnPath(text(formData, "next")));
}

export async function requestPasswordResetAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  return attempt(async () => {
    await requestPasswordReset(
      db,
      await customerDeps(),
      await customerRequest(),
      text(formData, "email"),
    );
    return {
      notice:
        "If that address has an account, we have sent it a link to choose a new password. The link works for one hour.",
    };
  });
}

export async function resetPasswordAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const result = await attempt(async () => {
    await resetPassword(
      db,
      await customerRequest(),
      text(formData, "token"),
      text(formData, "password"),
    );
    return {};
  });
  if (result.error) return result;
  await clearCustomerSession();
  redirect("/account/sign-in?reset=1");
}

// --- Signed in -------------------------------------------------------------------

export async function signOutAction(
  _previous?: AccountFormState,
  _formData?: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  await signOutCustomer(db, await readCustomerSessionToken());
  await clearCustomerSession();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function updateProfileAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const customer = await requireCustomer("/account");
  return attempt(
    async () => {
      await updateCustomerProfile(db, customer.id, {
        name: text(formData, "name"),
        phone: text(formData, "phone"),
      });
      await setMarketingConsent(
        db,
        customer.id,
        formData.get("marketing") === "on",
        "account_page",
      );
      revalidatePath("/account");
      return { notice: "Saved." };
    },
    keep(formData, ["name", "phone", "marketing"]),
  );
}

const ADDRESS_FIELDS = [
  "fullName",
  "phone",
  "line1",
  "line2",
  "city",
  "region",
  "postalCode",
  "country",
] as const;

const addressInput = (formData: FormData): AddressInput => ({
  fullName: text(formData, "fullName"),
  phone: text(formData, "phone"),
  line1: text(formData, "line1"),
  line2: text(formData, "line2"),
  city: text(formData, "city"),
  region: text(formData, "region"),
  postalCode: text(formData, "postalCode"),
  country: text(formData, "country"),
});

export async function createAddressAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const customer = await requireCustomer("/account/addresses");
  const result = await attempt(
    async () => {
      await createAddress(db, customer.id, addressInput(formData));
      return {};
    },
    keep(formData, ADDRESS_FIELDS),
  );
  if (result.error) return result;
  revalidatePath("/account/addresses");
  redirect("/account/addresses?saved=1");
}

export async function updateAddressAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const customer = await requireCustomer("/account/addresses");
  const result = await attempt(
    async () => {
      await updateAddress(db, customer.id, text(formData, "id"), addressInput(formData));
      return {};
    },
    keep(formData, ADDRESS_FIELDS),
  );
  if (result.error) return result;
  revalidatePath("/account/addresses");
  redirect("/account/addresses?saved=1");
}

export async function deleteAddressAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const customer = await requireCustomer("/account/addresses");
  return attempt(async () => {
    await deleteAddress(db, customer.id, text(formData, "id"));
    revalidatePath("/account/addresses");
    return {};
  });
}

export async function setDefaultAddressAction(
  _previous: AccountFormState,
  formData: FormData,
): Promise<AccountFormState> {
  const { db } = await storefrontDb();
  const customer = await requireCustomer("/account/addresses");
  const use = text(formData, "use") === "billing" ? "billing" : "shipping";
  return attempt(async () => {
    await setDefaultAddress(db, customer.id, text(formData, "id"), use);
    revalidatePath("/account/addresses");
    return {};
  });
}
