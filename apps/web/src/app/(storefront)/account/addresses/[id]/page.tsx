import { CustomerError, getAddress } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { AccountForm } from "../../../_components/account-form";
import { AddressFields } from "../../../_components/address-fields";
import { updateAddressAction } from "../../actions";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Edit address") };
}

export default async function EditAddressPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await shopT();
  const { id } = await params;
  const customer = await requireCustomer(`/account/addresses/${encodeURIComponent(id)}`);
  const { db } = await storefrontDb();
  // Looked up inside this customer's own addresses: anyone else's is "not found".
  const address = await getAddress(db, customer.id, id).catch((error: unknown) => {
    if (error instanceof CustomerError) notFound();
    throw error;
  });

  return (
    <>
      <div>
        <Link href="/account/addresses" className="text-sm underline underline-offset-4">
          {t("Back to your addresses")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("Edit address")}
        </h1>
      </div>
      <AccountForm
        action={updateAddressAction}
        submitLabel={t("Save address")}
        testId="address-form"
      >
        <input type="hidden" name="id" value={address.id} />
        <AddressFields address={address} />
      </AccountForm>
    </>
  );
}
