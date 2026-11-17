import { formatAddress, listAddresses, MAX_ADDRESSES } from "@ecom/core";
import { Alert, Badge, buttonClasses, EmptyState } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { ButtonForm } from "../../_components/account-form";
import { deleteAddressAction, setDefaultAddressAction } from "../actions";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Your addresses") };
}

type Params = Record<string, string | string[] | undefined>;

export default async function AddressesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await shopT();
  const customer = await requireCustomer("/account/addresses");
  const { db } = await storefrontDb();
  const [addresses, params] = await Promise.all([listAddresses(db, customer.id), searchParams]);

  return (
    <>
      <div>
        <Link href="/account" className="text-sm underline underline-offset-4">
          {t("Back to your account")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("Your addresses")}
        </h1>
      </div>
      {params.saved ? (
        <Alert tone="success" testId="account-notice">
          {t("Address saved.")}
        </Alert>
      ) : null}

      {addresses.length === 0 ? (
        <EmptyState title={t("No saved addresses yet")}>
          {t("Save one now to check out faster later.")}
        </EmptyState>
      ) : (
        <ul className="flex flex-col gap-4" data-testid="address-list">
          {addresses.map((address) => (
            <li
              key={address.id}
              className="flex flex-col gap-3 rounded-card border border-line p-4"
              data-testid="address"
            >
              <div className="flex flex-wrap gap-2">
                {address.isDefaultShipping ? (
                  <Badge tone="success">{t("Default delivery")}</Badge>
                ) : null}
                {address.isDefaultBilling ? (
                  <Badge tone="neutral">{t("Default billing")}</Badge>
                ) : null}
              </div>
              <address className="text-sm not-italic">
                {formatAddress(address).map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
              <div className="flex flex-wrap items-start gap-2">
                <Link
                  href={`/account/addresses/${address.id}`}
                  className={buttonClasses("secondary")}
                >
                  {t("Edit")}
                  <span className="sr-only"> {address.line1}</span>
                </Link>
                {!address.isDefaultShipping ? (
                  <ButtonForm
                    action={setDefaultAddressAction}
                    label={t("Use for delivery")}
                    fields={{ id: address.id, use: "shipping" }}
                  />
                ) : null}
                {!address.isDefaultBilling ? (
                  <ButtonForm
                    action={setDefaultAddressAction}
                    label={t("Use for billing")}
                    fields={{ id: address.id, use: "billing" }}
                  />
                ) : null}
                <ButtonForm
                  action={deleteAddressAction}
                  label={t("Remove")}
                  fields={{ id: address.id }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}

      {addresses.length < MAX_ADDRESSES ? (
        <div>
          <Link href="/account/addresses/new" className={buttonClasses()}>
            {t("Add an address")}
          </Link>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          {t("You have saved the most addresses allowed ({count}). Remove one to add another.", {
            count: MAX_ADDRESSES,
          })}
        </p>
      )}
    </>
  );
}
