import { getOrderForShopper, NotFoundError } from "@ecom/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getCurrentCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { OrderDetails } from "../../_components/order-details";

// A guest's order page, opened with the key from the confirmation link.
// Without the right key (or as anyone but the customer who placed it) the
// page does not exist.
export const metadata: Metadata = {
  title: "Your order",
  robots: { index: false, follow: false },
  // The key is in this page's address: never pass it on to other sites.
  referrer: "no-referrer",
};

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Params>;
}) {
  const [{ id }, query, customer] = await Promise.all([params, searchParams, getCurrentCustomer()]);
  const { db } = await storefrontDb();
  const accessKey = first(query.key);
  const order = await getOrderForShopper(db, id, {
    customerId: customer?.id ?? null,
    accessKey: accessKey ?? null,
  }).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound();
    throw error;
  });
  return (
    <div className="mx-auto w-full max-w-2xl">
      <OrderDetails order={order} accessKey={accessKey} />
    </div>
  );
}
