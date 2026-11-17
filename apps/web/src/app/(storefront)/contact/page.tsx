import { Card } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { AccountField, AccountForm, AccountTextArea } from "../_components/account-form";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { startConversationAction } from "../support/actions";

export const metadata: Metadata = { title: "Contact us", alternates: { canonical: "/contact" } };

// Write to the store. Signed-in customers find the conversation in their
// account; guests get a private link by email.
export default async function ContactPage() {
  const [{ store }, customer] = await Promise.all([storefrontDb(), getCurrentCustomer()]);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-6">
      <Breadcrumbs trail={[{ name: "Home", href: "/" }]} current="Contact us" />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Contact us</h1>
        <p className="text-ink-muted">
          Questions about a product or an order? Write to {store.name} and we will reply by email.
          {customer ? (
            <>
              {" "}
              Your messages are also in{" "}
              <Link href="/account/messages" className="text-ink underline underline-offset-4">
                your account
              </Link>
              .
            </>
          ) : null}
        </p>
        {store.branding.contactPhone ? (
          <p className="text-sm text-ink-muted">Or call {store.branding.contactPhone}.</p>
        ) : null}
      </div>
      <Card>
        <AccountForm
          action={startConversationAction}
          submitLabel="Send message"
          testId="contact-form"
        >
          {customer ? (
            <p className="text-sm" data-testid="contact-signed-in">
              Writing as <span className="font-medium">{customer.email}</span>.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <AccountField label="Your name" name="name" autoComplete="name" maxLength={100} />
              <AccountField label="Email" name="email" type="email" autoComplete="email" />
            </div>
          )}
          <AccountField label="Subject" name="subject" maxLength={150} />
          <AccountField
            label="Order number"
            name="orderNumber"
            inputMode="numeric"
            hint="Optional, if it is about an order."
          />
          <AccountTextArea label="Message" name="message" rows={6} maxLength={5000} />
          {/* Left empty by people; bots that fill every field are ignored. */}
          <div aria-hidden="true" className="hidden">
            <label htmlFor="website">Website</label>
            <input id="website" name="website" type="text" tabIndex={-1} autoComplete="off" />
          </div>
        </AccountForm>
      </Card>
    </div>
  );
}
