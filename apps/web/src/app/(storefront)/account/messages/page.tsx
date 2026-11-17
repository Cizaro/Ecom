import { msg } from "@ecom/i18n";
import { listCustomerConversations } from "@ecom/core";
import { buttonClasses, Card } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requireCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Messages") };
}

const STATUS = {
  open: msg("Waiting for the store"),
  waiting: msg("The store replied"),
  closed: msg("Closed"),
};

export default async function MessagesPage() {
  const t = await shopT();
  const customer = await requireCustomer("/account/messages");
  const { db } = await storefrontDb();
  const conversations = await listCustomerConversations(db, customer.id);
  const when = new Intl.DateTimeFormat(t.intl, { dateStyle: "medium" });
  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/account" className="text-sm underline underline-offset-4">
          {t("Your account")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Messages")}</h1>
      </div>
      <Card>
        {conversations.length === 0 ? (
          <p className="text-sm text-ink-muted">{t("You have not written to us yet.")}</p>
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
                  {t(STATUS[conversation.status])} · {when.format(conversation.lastMessageAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Link href="/contact" className={buttonClasses("secondary")}>
            {t("Write to us")}
          </Link>
        </div>
      </Card>
    </>
  );
}
