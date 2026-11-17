import { getConversationForShopper, NotFoundError } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { ConversationThread } from "../../../_components/conversation-thread";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Message") };
}

export default async function MessagePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await shopT();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const customer = await requireCustomer(`/account/messages/${id}`);
  const { db } = await storefrontDb();
  let conversation;
  try {
    conversation = await getConversationForShopper(db, id, { customerId: customer.id });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return (
    <>
      <Link href="/account/messages" className="text-sm underline underline-offset-4">
        {t("All messages")}
      </Link>
      <ConversationThread conversation={conversation} justSent={query.sent === "1"} />
    </>
  );
}
