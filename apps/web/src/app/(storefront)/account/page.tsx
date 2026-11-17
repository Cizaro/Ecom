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
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Your account") };
}

type Params = Record<string, string | string[] | undefined>;

export default async function AccountPage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await shopT();
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
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("Your account")}</h1>
        <p className="mt-1 text-ink-muted" data-testid="account-email">
          {customer.email}
        </p>
      </div>
      {params.welcome ? (
        <Alert tone="success" testId="account-notice">
          {t("Your email address is confirmed and you are signed in.")}
        </Alert>
      ) : null}

      <Card title={t("Details")}>
        <AccountForm action={updateProfileAction} submitLabel={t("Save")} testId="profile-form">
          <AccountField
            label={t("Name")}
            name="name"
            autoComplete="name"
            maxLength={200}
            defaultValue={customer.name}
          />
          <AccountField
            label={t("Phone")}
            name="phone"
            type="tel"
            autoComplete="tel"
            hint={t("Optional. Used only about your orders.")}
            defaultValue={customer.phone ?? ""}
          />
          <AccountCheckbox
            label={t("Email me news and offers")}
            name="marketing"
            defaultChecked={marketing}
          />
        </AccountForm>
      </Card>

      <Card title={t("Addresses")}>
        {shipping ? (
          <address className="text-sm text-ink-muted not-italic">
            {formatAddress(shipping, t.intl).map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </address>
        ) : (
          <p className="text-sm text-ink-muted">{t("No saved addresses yet.")}</p>
        )}
        <div>
          <Link href="/account/addresses" className={buttonClasses("secondary")}>
            {t("Manage addresses")}
          </Link>
        </div>
      </Card>

      <Card title={t("Orders")}>
        <p className="text-sm text-ink-muted">{t("Orders you place while signed in.")}</p>
        <div>
          <Link href="/account/orders" className={buttonClasses("secondary")}>
            {t("See your orders")}
          </Link>
        </div>
      </Card>

      <Card title={t("Messages")}>
        <p className="text-sm text-ink-muted">{t("Your conversations with the store.")}</p>
        <div>
          <Link href="/account/messages" className={buttonClasses("secondary")}>
            {t("See your messages")}
          </Link>
        </div>
      </Card>

      <Card title={t("Photos")}>
        <p className="text-sm text-ink-muted">
          {t("Share photos and videos of what you bought, and manage your permission.")}
        </p>
        <div>
          <Link href="/account/photos" className={buttonClasses("secondary")}>
            {t("My photos")}
          </Link>
        </div>
      </Card>

      <ButtonForm action={signOutAction} label={t("Sign out")} />
    </>
  );
}
