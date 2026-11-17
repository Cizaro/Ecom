import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/server/customer";
import { AccountForm } from "../../../_components/account-form";
import { AddressFields } from "../../../_components/address-fields";
import { createAddressAction } from "../../actions";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Add an address") };
}

export default async function NewAddressPage() {
  const t = await shopT();
  await requireCustomer("/account/addresses/new");
  return (
    <>
      <div>
        <Link href="/account/addresses" className="text-sm underline underline-offset-4">
          {t("Back to your addresses")}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          {t("Add an address")}
        </h1>
      </div>
      <AccountForm
        action={createAddressAction}
        submitLabel={t("Save address")}
        testId="address-form"
      >
        <AddressFields />
      </AccountForm>
    </>
  );
}
