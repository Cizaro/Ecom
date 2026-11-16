import { hasPermission, listLocations } from "@ecom/core";
import { Badge, Card, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm, TextField } from "../../../_components/form";
import { createLocationAction, setDefaultLocationAction, updateLocationAction } from "../actions";

export const metadata: Metadata = { title: "Stock locations" };

export default async function LocationsPage() {
  const { context } = await requirePermission("inventory.read");
  const locations = await listLocations(tenantDb(context), context);
  const canAdjust = hasPermission(context, "inventory.adjust");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Stock locations"
        description={
          <>
            Where stock is kept. Checkout takes stock from the default location first.{" "}
            <Link href="/admin/inventory" className="underline underline-offset-4">
              Back to stock
            </Link>
          </>
        }
      />
      <List testId="location-list">
        {locations.map((location) => (
          <ListItem key={location.id} testId="location-row">
            <div className="flex w-full flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{location.name}</span>
                {location.isDefault ? <Badge tone="success">Default</Badge> : null}
              </div>
              {canAdjust ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <ActionForm
                      action={updateLocationAction}
                      submitLabel="Save"
                      submitTone="secondary"
                    >
                      <input type="hidden" name="id" value={location.id} />
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField
                          id={`name-${location.id}`}
                          label="Name"
                          name="name"
                          maxLength={100}
                          defaultValue={location.name}
                        />
                        <TextField
                          id={`address-${location.id}`}
                          label="Address"
                          name="address"
                          maxLength={300}
                          defaultValue={location.address ?? ""}
                        />
                      </div>
                    </ActionForm>
                  </div>
                  {!location.isDefault ? (
                    <ActionForm
                      action={setDefaultLocationAction}
                      submitLabel="Make default"
                      submitTone="secondary"
                    >
                      <input type="hidden" name="id" value={location.id} />
                    </ActionForm>
                  ) : null}
                </div>
              ) : location.address ? (
                <p className="text-sm text-ink-muted">{location.address}</p>
              ) : null}
            </div>
          </ListItem>
        ))}
      </List>
      {canAdjust ? (
        <Card title="Add a location">
          <ActionForm action={createLocationAction} submitLabel="Add location">
            <TextField label="Name" name="name" maxLength={100} required />
            <TextField label="Address" name="address" maxLength={300} hint="Optional" />
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
