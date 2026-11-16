import {
  describeZone,
  getTaxSettings,
  listShippingZones,
  MAX_ZONES,
  zoneFormValues,
} from "@ecom/core";
import { Badge, Card, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import { requirePermission, tenantDb } from "@/server/access";
import {
  ActionForm,
  CheckboxField,
  DangerForm,
  SelectField,
  TextField,
} from "../../../_components/form";
import {
  createShippingZoneAction,
  deleteShippingZoneAction,
  saveTaxSettingsAction,
  updateShippingZoneAction,
} from "../actions";

export const metadata: Metadata = { title: "Delivery and tax" };

const TAX_MODES = [
  { value: "true", label: "Prices already include tax" },
  { value: "false", label: "Add tax at checkout" },
] as const;

export default async function ShippingSettingsPage() {
  const { context } = await requirePermission("settings.write");
  const db = tenantDb(context);
  const [{ zones, currency }, tax] = await Promise.all([
    listShippingZones(db, context),
    getTaxSettings(db, context),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Delivery and tax"
        description="Where you deliver, what it costs, and how tax is charged. Shoppers pick their delivery area at checkout and see the price before they order. Orders keep the prices they were placed with."
      />

      <Card title="Delivery areas">
        {zones.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="no-zones">
            No delivery areas yet, so checkout charges no delivery and accepts any country. Add your
            first area below, for example &ldquo;Beirut&rdquo; for country LB.
          </p>
        ) : (
          <List testId="zone-list">
            {zones.map((zone) => {
              const values = zoneFormValues(zone);
              return (
                <ListItem key={zone.id} testId="zone-row">
                  <div className="flex w-full flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium" data-testid="zone-summary">
                        {describeZone(zone)}
                      </span>
                      <Badge>{zone.countries.join(", ")}</Badge>
                      {zone.isActive ? null : <Badge tone="warning">Not offered</Badge>}
                    </div>
                    <details>
                      <summary className="cursor-pointer text-sm underline underline-offset-4">
                        Edit {zone.name}
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        <ActionForm
                          action={updateShippingZoneAction}
                          submitLabel="Save"
                          submitTone="secondary"
                          testId="zone-edit-form"
                        >
                          <input type="hidden" name="id" value={zone.id} />
                          <ZoneFields
                            idPrefix={zone.id}
                            currency={zone.currency}
                            name={zone.name}
                            countries={values.countries}
                            rate={values.rate}
                            freeOver={values.freeOver}
                            position={String(zone.position)}
                            isActive={zone.isActive}
                          />
                        </ActionForm>
                        <DangerForm
                          action={deleteShippingZoneAction}
                          submitLabel="Delete area"
                          confirmMessage={`Delete the delivery area "${zone.name}"? Past orders keep their delivery price.`}
                        >
                          <input type="hidden" name="id" value={zone.id} />
                        </DangerForm>
                      </div>
                    </details>
                  </div>
                </ListItem>
              );
            })}
          </List>
        )}
      </Card>

      {zones.length < MAX_ZONES ? (
        <Card title="Add a delivery area">
          <ActionForm
            action={createShippingZoneAction}
            submitLabel="Add area"
            testId="zone-create-form"
          >
            <ZoneFields idPrefix="new" currency={currency} isActive />
          </ActionForm>
        </Card>
      ) : null}

      <Card title="Tax">
        <ActionForm action={saveTaxSettingsAction} submitLabel="Save tax" testId="tax-form">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Tax rate (%)"
              name="rate"
              inputMode="decimal"
              hint="0 for no tax. Check the rate with your accountant."
              defaultValue={(tax.rateBasisPoints / 100).toString()}
            />
            <TextField
              label="Tax name"
              name="label"
              maxLength={30}
              hint="Shown to shoppers, e.g. VAT"
              defaultValue={tax.label}
            />
          </div>
          <SelectField
            label="Prices and tax"
            name="included"
            defaultValue={String(tax.included)}
            options={TAX_MODES}
          />
        </ActionForm>
      </Card>
    </div>
  );
}

function ZoneFields(props: {
  idPrefix: string;
  currency: string;
  name?: string;
  countries?: string;
  rate?: string;
  freeOver?: string;
  position?: string;
  isActive: boolean;
}) {
  const id = (name: string) => `${name}-${props.idPrefix}`;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={id("name")}
          label="Area name"
          name="name"
          maxLength={100}
          hint="What shoppers pick, e.g. Beirut"
          defaultValue={props.name}
        />
        <TextField
          id={id("countries")}
          label="Country codes"
          name="countries"
          hint="Two letters, comma separated, e.g. LB"
          defaultValue={props.countries ?? "LB"}
        />
        <TextField
          id={id("rate")}
          label={`Delivery price (${props.currency})`}
          name="rate"
          inputMode="decimal"
          hint="0 for free delivery"
          defaultValue={props.rate}
        />
        <TextField
          id={id("freeOver")}
          label={`Free delivery over (${props.currency})`}
          name="freeOver"
          inputMode="decimal"
          hint="Optional"
          defaultValue={props.freeOver}
        />
        <TextField
          id={id("position")}
          label="Order in the list"
          name="position"
          inputMode="numeric"
          hint="Lower numbers come first"
          defaultValue={props.position ?? "0"}
        />
      </div>
      <CheckboxField
        id={id("isActive")}
        label="Offer this area at checkout"
        name="isActive"
        defaultChecked={props.isActive}
      />
    </>
  );
}
