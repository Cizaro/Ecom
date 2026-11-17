import { getConversationForShopper, NotFoundError } from "@ecom/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { storefrontDb } from "@/server/storefront";
import { ConversationThread } from "../../_components/conversation-thread";

export const metadata: Metadata = {
  title: "Your message",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

// A guest's conversation, opened with the private link from their email.
export default async function GuestConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { db } = await storefrontDb();
  const [{ id }, query] = await Promise.all([params, searchParams]);
  const key = typeof query.key === "string" ? query.key : "";
  let conversation;
  try {
    conversation = await getConversationForShopper(db, id, { accessKey: key });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <ConversationThread
        conversation={conversation}
        accessKey={key}
        justSent={query.sent === "1"}
      />
    </div>
  );
}
