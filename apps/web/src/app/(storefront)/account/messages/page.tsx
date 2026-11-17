import { listCustomerConversations } from "@ecom/core";
import { buttonClasses, Card } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";

export const metadata: Metadata = { title: "Messages" };

const STATUS = {
  open: "Waiting for the store",
  waiting: "The store replied",
  closed: "Closed",
};

export default async function MessagesPage() {
  const customer = await requireCustomer("/account/messages");
  const { db } = await storefrontDb();
  const conversations = await listCustomerConversations(db, customer.id);
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium" });
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/account" className="text-sm underline underline-offset-4">
          Your account
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">Messages</h1>
      </div>
      <Card>
        {conversations.length === 0 ? (
          <p className="text-sm text-ink-muted">You have not written to us yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid="my-conversations">
            {conversations.map((conversation) => (
              <li key={conversation.id} className="flex flex-col py-3 text-sm">
                <Link
                  href={`/account/messages/${conversation.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {conversation.subject}
                </Link>
                <span className="text-ink-muted">
                  {STATUS[conversation.status]} · {when.format(conversation.lastMessageAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Link href="/contact" className={buttonClasses("secondary")}>
            Write to us
          </Link>
        </div>
      </Card>
    </>
  );
}
