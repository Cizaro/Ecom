import { BRANDING_PRESETS, getStoreSettings, themeVariables } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import type { CSSProperties } from "react";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm, CheckboxField, SelectField, TextField } from "../../../_components/form";
import { SingleImage } from "../../catalog/_components/single-image";
import {
  removeStoreLogoAction,
  setStoreLogoAction,
  updateStoreBrandingAction,
  updateStoreDetailsAction,
} from "../actions";

export const metadata: Metadata = { title: "Store and look" };

const CORNERS = [
  { value: "sharp", label: "Sharp (square corners)" },
  { value: "soft", label: "Soft (slightly rounded)" },
  { value: "round", label: "Round" },
] as const;

const FONTS = [
  { value: "sans", label: "Clean (sans-serif)" },
  { value: "serif", label: "Classic (serif)" },
  { value: "rounded", label: "Friendly (rounded)" },
] as const;

export default async function StoreSettingsPage() {
  const { context } = await requirePermission("settings.write");
  const store = await getStoreSettings(tenantDb(context), context);
  const { branding } = store;
  const timeZones = Intl.supportedValuesOf("timeZone");
  const zoneOptions = (
    timeZones.includes(store.timezone) ? timeZones : [store.timezone, ...timeZones]
  ).map((zone) => ({ value: zone, label: zone.replace(/_/g, " ") }));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Store and look"
        description="Your store's name, contact details and how your shop looks. Changes show on your shop straight away."
      />

      <Card title="Store details">
        <ActionForm
          action={updateStoreDetailsAction}
          submitLabel="Save details"
          testId="store-details-form"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Store name" name="name" maxLength={100} defaultValue={store.name} />
            <SelectField
              label="Time zone"
              name="timezone"
              hint="Used for &ldquo;today&rdquo; on the dashboard and for dates."
              defaultValue={store.timezone}
              options={zoneOptions}
            />
          </div>
          <TextField
            label="Tagline"
            name="tagline"
            maxLength={160}
            hint="Optional. A short line shown at the bottom of your shop."
            defaultValue={branding.tagline}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Contact email"
              name="contactEmail"
              type="email"
              hint="Optional. Shown at the bottom of your shop."
              defaultValue={branding.contactEmail}
            />
            <TextField
              label="Contact phone"
              name="contactPhone"
              type="tel"
              hint="Optional. Shown at the bottom of your shop."
              defaultValue={branding.contactPhone}
            />
          </div>
          <CheckboxField
            label="Offer the shop in Arabic too"
            name="arabic"
            hint="Shoppers see an Arabic button in the shop's header; English stays the default. Add Arabic names and descriptions to products and categories, and Arabic policy pages, for a complete Arabic shop."
            defaultChecked={store.languages.includes("ar")}
          />
          <p className="text-sm text-ink-muted">Prices are in {store.currency}.</p>
        </ActionForm>
      </Card>

      <SingleImage
        title="Logo"
        description="Shown next to your store's name at the top of your shop. A PNG with a transparent background works best."
        noun="logo"
        id={store.id}
        image={store.logo}
        alt={`${store.name} logo`}
        setAction={setStoreLogoAction}
        removeAction={removeStoreLogoAction}
      />

      <Card title="Look">
        <div
          className="flex flex-wrap items-center gap-4 rounded-card border border-line p-4 font-sans"
          style={themeVariables(branding) as CSSProperties}
          data-testid="look-preview"
          aria-label="How your shop's buttons and prices look now"
        >
          <span className="rounded-control bg-brand px-4 py-2 text-sm font-medium text-brand-contrast">
            Add to cart
          </span>
          <span className="rounded-control border border-line-strong px-4 py-2 text-sm font-medium">
            Search
          </span>
          <span className="text-sm">
            <span className="text-ink-muted line-through">$50.00</span>{" "}
            <span className="font-medium text-accent">$39.00</span>
          </span>
        </div>
        <ActionForm
          action={updateStoreBrandingAction}
          submitLabel="Save look"
          testId="store-look-form"
        >
          <SelectField
            label="Start from a ready-made look"
            name="preset"
            hint="Choosing one replaces the colours, corners and font below."
            defaultValue=""
            options={[
              { value: "", label: "Use my own choices below" },
              ...BRANDING_PRESETS.map((preset) => ({ value: preset.key, label: preset.label })),
            ]}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Main colour"
              name="brandColor"
              hint="Buttons and highlights, like #1c1917. Button text is chosen to stay readable."
              defaultValue={branding.brandColor}
            />
            <TextField
              label="Accent colour"
              name="accentColor"
              hint="Sale prices and small accents, like #b45309. Must be dark enough to read on white."
              defaultValue={branding.accentColor}
            />
            <SelectField
              label="Corners"
              name="corners"
              defaultValue={branding.corners}
              options={CORNERS}
            />
            <SelectField label="Font" name="font" defaultValue={branding.font} options={FONTS} />
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
