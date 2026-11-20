import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import { requirePlatformAdmin } from "@/server/access";
import { ActionForm, SelectField, TextField } from "../../../../_components/form";
import { createShopAction } from "../../actions";

export const metadata: Metadata = { title: "New shop" };

const CURRENCIES = ["USD", "LBP", "EUR", "AED", "SAR"].map((c) => ({ value: c, label: c }));
const ZONES = ["Asia/Beirut", "Asia/Dubai", "Asia/Riyadh", "Europe/London", "UTC"].map((z) => ({
  value: z,
  label: z,
}));

// Sets up a shop for a client: its web address and its first owner, who gets
// an email to choose a password.
export default async function NewShopPage() {
  await requirePlatformAdmin();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New shop"
        description="Creates the shop, its web address and its owner's account. The owner gets an email to choose a password."
      />
      <Card title="Shop">
        <ActionForm action={createShopAction} submitLabel="Create shop" testId="new-shop-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Shop name" name="name" required maxLength={80} />
            <TextField
              label="Short name"
              name="slug"
              required
              maxLength={42}
              hint="Lower-case letters, digits and dashes, e.g. tamara. Not shown to shoppers."
            />
            <TextField
              label="Web address"
              name="address"
              required
              hint="e.g. tamara.yourplatform.com, or the client's own domain (no https://)."
            />
            <TextField label="Owner's email" name="ownerEmail" type="email" required />
            <TextField label="Owner's name" name="ownerName" maxLength={100} />
            <SelectField label="Currency" name="currency" options={CURRENCIES} defaultValue="USD" />
            <SelectField
              label="Time zone"
              name="timezone"
              options={ZONES}
              defaultValue="Asia/Beirut"
            />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
