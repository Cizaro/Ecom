import { CustomerError, getAddress } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { AccountForm } from "../../../_components/account-form";
import { AddressFields } from "../../../_components/address-fields";
import { updateAddressAction } from "../../actions";

export const metadata: Metadata = { title: "Edit address" };

export default async function EditAddressPage({ params }: { params: Promise<{ id: string }> }) {
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
          Back to your addresses
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">Edit address</h1>
      </div>
      <AccountForm action={updateAddressAction} submitLabel="Save address" testId="address-form">
        <input type="hidden" name="id" value={address.id} />
        <AddressFields address={address} />
      </AccountForm>
    </>
  );
}
