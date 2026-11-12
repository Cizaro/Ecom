import { moneyToInput, type VariantDetail } from "@ecom/core";
import { SelectField, TextField } from "../../../_components/form";

const money = (amount: number | null | undefined, currency: string) =>
  amount === null || amount === undefined ? "" : moneyToInput(amount, currency);

/** The fields of one variant, shared by the add and edit screens. */
export function VariantFields({
  currency,
  variant,
}: {
  currency: string;
  variant?: VariantDetail;
}) {
  const example = moneyToInput(4990, currency);
  return (
    <>
      <TextField
        label="SKU"
        name="sku"
        required
        maxLength={64}
        hint="Your own code for this exact item. Must be unique in the store."
        defaultValue={variant?.sku ?? ""}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Color" name="color" maxLength={80} defaultValue={variant?.color ?? ""} />
        <TextField label="Size" name="size" maxLength={80} defaultValue={variant?.size ?? ""} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label={`Price (${currency})`}
          name="price"
          required
          inputMode="decimal"
          hint={`For example ${example}`}
          defaultValue={money(variant?.priceAmount, currency)}
        />
        <TextField
          label={`Sale price (${currency})`}
          name="salePrice"
          inputMode="decimal"
          hint="Optional. Must be lower than the price."
          defaultValue={money(variant?.discountPriceAmount, currency)}
        />
        <TextField
          label={`Compare-at price (${currency})`}
          name="compareAtPrice"
          inputMode="decimal"
          hint="Optional. A higher price this item was really sold at before."
          defaultValue={money(variant?.compareAtAmount, currency)}
        />
        <TextField
          label={`Cost (${currency})`}
          name="cost"
          inputMode="decimal"
          hint="Optional. What you paid. Never shown to shoppers."
          defaultValue={money(variant?.costAmount, currency)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Barcode"
          name="barcode"
          maxLength={64}
          defaultValue={variant?.barcode ?? ""}
        />
        <TextField
          label="Weight (grams)"
          name="weightGrams"
          inputMode="numeric"
          defaultValue={variant?.weightGrams?.toString() ?? ""}
        />
        <TextField
          label="Low-stock level"
          name="lowStockThreshold"
          inputMode="numeric"
          hint="Optional. Used for low-stock alerts once inventory is set up."
          defaultValue={variant?.lowStockThreshold?.toString() ?? ""}
        />
        <SelectField
          label="Availability"
          name="status"
          defaultValue={variant?.status ?? "active"}
          options={[
            { value: "active", label: "For sale" },
            { value: "inactive", label: "Not for sale" },
          ]}
        />
      </div>
    </>
  );
}
