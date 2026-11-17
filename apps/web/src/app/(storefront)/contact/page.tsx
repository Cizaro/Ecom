import { Card } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { AccountField, AccountForm, AccountTextArea } from "../_components/account-form";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { startConversationAction } from "../support/actions";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Contact us"), alternates: { canonical: "/contact" } };
}

// Write to the store. Signed-in customers find the conversation in their
// account; guests get a private link by email.
export default async function ContactPage() {
  const t = await shopT();
  const [{ store }, customer] = await Promise.all([storefrontDb(), getCurrentCustomer()]);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <Breadcrumbs trail={[{ name: t("Home"), href: "/" }]} current={t("Contact us")} />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("Contact us")}</h1>
        <p className="text-ink-muted">
          {t(
            "Questions about a product or an order? Write to {store} and we will reply by email.",
            {
              store: store.name,
            },
          )}
          {customer ? (
            <>
              {" "}
              {t("Your messages are also in")}{" "}
              <Link href="/account/messages" className="text-ink underline underline-offset-4">
                {t("your account")}
              </Link>
              .
            </>
          ) : null}
        </p>
        {store.branding.contactPhone ? (
          <p className="text-sm text-ink-muted">
            {t("Or call {phone}.", { phone: store.branding.contactPhone })}
          </p>
        ) : null}
      </div>
      <Card>
        <AccountForm
          action={startConversationAction}
          submitLabel={t("Send message")}
          testId="contact-form"
        >
          {customer ? (
            <p className="text-sm" data-testid="contact-signed-in">
              {t("Writing as {email}.", { email: customer.email })}
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <AccountField
                label={t("Your name")}
                name="name"
                autoComplete="name"
                maxLength={100}
              />
              <AccountField label={t("Email")} name="email" type="email" autoComplete="email" />
            </div>
          )}
          <AccountField label={t("Subject")} name="subject" maxLength={150} />
          <AccountField
            label={t("Order number")}
            name="orderNumber"
            inputMode="numeric"
            hint={t("Optional, if it is about an order.")}
          />
          <AccountTextArea label={t("Message")} name="message" rows={6} maxLength={5000} />
          {/* Left empty by people; bots that fill every field are ignored. */}
          <div aria-hidden="true" className="hidden">
            <label htmlFor="website">{t("Website")}</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
        </AccountForm>
      </Card>
    </div>
  );
}
