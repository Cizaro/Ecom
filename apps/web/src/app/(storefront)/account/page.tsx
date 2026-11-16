import { getMarketingConsent, listAddresses, formatAddress } from "@ecom/core";
import { Alert, buttonClasses, Card } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import {
  AccountCheckbox,
  AccountField,
  AccountForm,
  ButtonForm,
} from "../_components/account-form";
import { signOutAction, updateProfileAction } from "./actions";

export const metadata: Metadata = { title: "Your account" };

type Params = Record<string, string | string[] | undefined>;

export default async function AccountPage({ searchParams }: { searchParams: Promise<Params> }) {
  const customer = await requireCustomer("/account");
  const { db } = await storefrontDb();
  const [marketing, addresses, params] = await Promise.all([
    getMarketingConsent(db, customer.id),
    listAddresses(db, customer.id),
    searchParams,
  ]);
  const shipping = addresses.find((address) => address.isDefaultShipping);

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Your account</h1>
        <p className="mt-1 text-ink-muted" data-testid="account-email">
          {customer.email}
        </p>
      </div>
      {params.welcome ? (
        <Alert tone="success" testId="account-notice">
          Your email address is confirmed and you are signed in.
        </Alert>
      ) : null}

      <Card title="Details">
        <AccountForm action={updateProfileAction} submitLabel="Save" testId="profile-form">
          <AccountField
            label="Name"
            name="name"
            autoComplete="name"
            maxLength={200}
            defaultValue={customer.name}
          />
          <AccountField
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            hint="Optional. Used only about your orders."
            defaultValue={customer.phone ?? ""}
          />
          <AccountCheckbox
            label="Email me news and offers"
            name="marketing"
            defaultChecked={marketing}
          />
        </AccountForm>
      </Card>

      <Card title="Addresses">
        {shipping ? (
          <address className="text-sm text-ink-muted not-italic">
            {formatAddress(shipping).map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        ) : (
          <p className="text-sm text-ink-muted">No saved addresses yet.</p>
        )}
        <div>
          <Link href="/account/addresses" className={buttonClasses("secondary")}>
            Manage addresses
          </Link>
        </div>
      </Card>

      <Card title="Orders">
        <p className="text-sm text-ink-muted">Your orders will appear here once checkout opens.</p>
      </Card>

      <ButtonForm action={signOutAction} label="Sign out" />
    </>
  );
}
