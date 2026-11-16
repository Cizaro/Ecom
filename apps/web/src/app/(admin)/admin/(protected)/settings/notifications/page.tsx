import { getNotificationSettings, listUndeliveredEmails, MAX_STAFF_ADDRESSES } from "@ecom/core";
import { Badge, Card, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm, TextAreaField } from "../../../_components/form";
import { retryEmailAction, saveNotificationSettingsAction } from "../actions";

export const metadata: Metadata = { title: "Store emails" };

const SHOPPER_EMAILS = [
  [
    "Order confirmed",
    "When a cash-on-delivery order is placed, or an online payment goes through.",
  ],
  ["Order on its way", "When you mark it as sent, with the courier and tracking you entered."],
  ["Payment received", "When you record the cash for a cash-on-delivery order."],
  ["Order cancelled", "When you cancel an order, or an online order is not paid in time."],
] as const;

export default async function NotificationSettingsPage() {
  const { context } = await requirePermission("settings.write");
  const db = tenantDb(context);
  const [settings, undelivered] = await Promise.all([
    getNotificationSettings(db, context),
    listUndeliveredEmails(db, context),
  ]);
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Store emails"
        description="Emails your store sends. Shoppers always get emails about their own orders; staff get the emails below once you add addresses."
      />

      <Card title="Emails shoppers get">
        <ul className="flex flex-col gap-2 text-sm">
          {SHOPPER_EMAILS.map(([name, detail]) => (
            <li key={name}>
              <span className="font-medium">{name}:</span>{" "}
              <span className="text-ink-muted">{detail}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Emails for staff">
        <ActionForm
          action={saveNotificationSettingsAction}
          submitLabel="Save email settings"
          testId="notification-settings-form"
        >
          <TextAreaField
            label="New orders"
            name="orderEmails"
            rows={2}
            hint={`Told about each order ready to prepare. Up to ${MAX_STAFF_ADDRESSES} addresses, separated by commas.`}
            defaultValue={settings.orderEmails.join(", ")}
          />
          <TextAreaField
            label="Low stock"
            name="stockEmails"
            rows={2}
            hint="Told when an order takes a product down to its low-stock level (at most once a day per product)."
            defaultValue={settings.stockEmails.join(", ")}
          />
        </ActionForm>
      </Card>

      <Card title="Emails not sent">
        {undelivered.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="no-undelivered">
            Every email has been sent.
          </p>
        ) : (
          <List testId="undelivered-list">
            {undelivered.map((email) => (
              <ListItem key={email.id} testId="undelivered-row">
                <div className="flex w-full flex-col gap-2 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{email.label}</span>
                    <Badge tone={email.givenUp ? "warning" : "neutral"}>
                      {email.givenUp ? "Gave up" : "Will try again"}
                    </Badge>
                    <span className="text-ink-muted">
                      {when.format(email.createdAt)} · {email.attempts} attempts
                    </span>
                    {email.orderId ? (
                      <Link
                        href={`/admin/orders/${email.orderId}`}
                        className="underline underline-offset-4"
                      >
                        Open order
                      </Link>
                    ) : null}
                  </div>
                  {email.lastError ? <p className="text-ink-muted">{email.lastError}</p> : null}
                  <ActionForm
                    action={retryEmailAction}
                    submitLabel="Try again"
                    submitTone="secondary"
                  >
                    <input type="hidden" name="id" value={email.id} />
                  </ActionForm>
                </div>
              </ListItem>
            ))}
          </List>
        )}
      </Card>
    </div>
  );
}
