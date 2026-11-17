import { getEnv } from "@ecom/config";
import { getPaymentForPayPage } from "@ecom/core";
import { Alert } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { safeReturnPath } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { ButtonForm } from "../../_components/account-form";
import { mockPayAction } from "../actions";
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("Test payment"), robots: { index: false, follow: false } };
}

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// Stands in for a payment provider's own page while the store uses the mock
// provider. A real provider's page is on the provider's site and is where
// card details are typed; nothing like that happens here.
export default async function MockPaymentPage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await shopT();
  if (getEnv().PAYMENT_PROVIDER !== "mock") notFound();
  const params = await searchParams;
  const providerPaymentId = first(params.payment) ?? "";
  const returnPath = safeReturnPath(first(params.return), "/");
  const { db } = await storefrontDb();
  const payment = await getPaymentForPayPage(db, providerPaymentId);
  if (!payment) notFound();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <Alert tone="warning" testId="test-mode">
        {t(
          "Test mode: no money moves and no card details are asked for. A real payment page replaces this one when a payment provider is connected.",
        )}
      </Alert>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Pay for order #{number}", { number: payment.orderNumber })}
        </h1>
        <p className="mt-2 text-3xl font-semibold" data-testid="pay-amount">
          {t.money(payment.amount, payment.currency)}
        </p>
      </div>
      {payment.status === "pending" ? (
        <div className="flex flex-col gap-3">
          <ButtonForm
            action={mockPayAction}
            label={t("Pay (test: succeeds)")}
            tone="primary"
            fields={{ payment: providerPaymentId, outcome: "succeed", return: returnPath }}
          />
          <ButtonForm
            action={mockPayAction}
            label={t("Decline (test: card refused)")}
            fields={{ payment: providerPaymentId, outcome: "decline", return: returnPath }}
          />
          <Link href={returnPath} className="text-sm underline underline-offset-4">
            {t("Leave without paying (the order waits for payment)")}
          </Link>
        </div>
      ) : (
        <p>
          {t("This payment has already been completed or replaced.")}{" "}
          <Link href={returnPath} className="underline underline-offset-4">
            {t("Back to the order")}
          </Link>
        </p>
      )}
    </div>
  );
}
