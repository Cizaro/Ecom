import { formatAddress, listAddresses, MAX_ADDRESSES } from "@ecom/core";
import { Alert, Badge, buttonClasses, EmptyState } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { ButtonForm } from "../../_components/account-form";
import { deleteAddressAction, setDefaultAddressAction } from "../actions";

export const metadata: Metadata = { title: "Your addresses" };

type Params = Record<string, string | string[] | undefined>;

export default async function AddressesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const customer = await requireCustomer("/account/addresses");
  const { db } = await storefrontDb();
  const [addresses, params] = await Promise.all([listAddresses(db, customer.id), searchParams]);

  return (
    <>
      <div>
        <Link href="/account" className="text-sm underline underline-offset-4">
          Back to your account
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Your addresses</h1>
      </div>
      {params.saved ? (
        <Alert tone="success" testId="account-notice">
          Address saved.
        </Alert>
      ) : null}

      {addresses.length === 0 ? (
        <EmptyState title="No saved addresses yet">
          Save one now to check out faster later.
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
                {address.isDefaultShipping ? <Badge tone="success">Default delivery</Badge> : null}
                {address.isDefaultBilling ? <Badge tone="neutral">Default billing</Badge> : null}
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
                  Edit<span className="sr-only"> {address.line1}</span>
                </Link>
                {!address.isDefaultShipping ? (
                  <ButtonForm
                    action={setDefaultAddressAction}
                    label="Use for delivery"
                    fields={{ id: address.id, use: "shipping" }}
                  />
                ) : null}
                {!address.isDefaultBilling ? (
                  <ButtonForm
                    action={setDefaultAddressAction}
                    label="Use for billing"
                    fields={{ id: address.id, use: "billing" }}
                  />
                ) : null}
                <ButtonForm
                  action={deleteAddressAction}
                  label="Remove"
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
            Add an address
          </Link>
        </div>
      ) : (
        <p className="text-sm text-ink-muted">
          You have saved the most addresses allowed ({MAX_ADDRESSES}). Remove one to add another.
        </p>
      )}
    </>
  );
}
