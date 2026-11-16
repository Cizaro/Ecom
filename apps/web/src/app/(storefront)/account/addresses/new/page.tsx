import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/server/customer";
import { AccountForm } from "../../../_components/account-form";
import { AddressFields } from "../../../_components/address-fields";
import { createAddressAction } from "../../actions";

export const metadata: Metadata = { title: "Add an address" };

export default async function NewAddressPage() {
  await requireCustomer("/account/addresses/new");
  return (
    <>
      <div>
        <Link href="/account/addresses" className="text-sm underline underline-offset-4">
          Back to your addresses
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Add an address</h1>
      </div>
      <AccountForm action={createAddressAction} submitLabel="Save address" testId="address-form">
        <AddressFields />
      </AccountForm>
    </>
  );
}
