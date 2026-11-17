import { getOrderForShopper, NotFoundError } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { OrderDetails } from "../../../_components/order-details";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Your order") };
}

export default async function AccountOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const t = await shopT();
  const { id } = await params;
  const customer = await requireCustomer(`/account/orders/${encodeURIComponent(id)}`);
  const { db } = await storefrontDb();
  // Only this customer's own orders open here.
  const order = await getOrderForShopper(db, id, { customerId: customer.id }).catch(
    (error: unknown) => {
      if (error instanceof NotFoundError) notFound();
      throw error;
    },
  );
  return (
    <>
      <Link href="/account/orders" className="text-sm underline underline-offset-4">
        {t("Back to your orders")}
      </Link>
      <OrderDetails order={order} />
    </>
  );
}
