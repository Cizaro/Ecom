import { SelectField, TextField } from "../../../_components/form";

export interface SegmentFormValue {
  name: string;
  minOrders: string;
  minSpent: string;
  orderedWithinDays: string;
  noOrderForDays: string;
  categoryId: string;
}

/** The segment's rules; empty fields mean no rule. */
export function SegmentFields({
  categories,
  currency,
  value,
}: {
  categories: { id: string; name: string }[];
  currency: string;
  value?: SegmentFormValue;
}) {
  return (
    <>
      <TextField label="Segment name" name="name" maxLength={80} defaultValue={value?.name} />
      <p className="text-sm text-ink-muted">
        Customers who match all the rules you fill in. Leave a rule empty to skip it; with no rules,
        everyone is in it.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="At least this many orders"
          name="minOrders"
          inputMode="numeric"
          defaultValue={value?.minOrders}
        />
        <TextField
          label={`Spent at least (${currency})`}
          name="minSpent"
          inputMode="decimal"
          defaultValue={value?.minSpent}
        />
        <TextField
          label="Ordered in the last … days"
          name="orderedWithinDays"
          inputMode="numeric"
          defaultValue={value?.orderedWithinDays}
        />
        <TextField
          label="No order for at least … days"
          name="noOrderForDays"
          inputMode="numeric"
          defaultValue={value?.noOrderForDays}
          hint="Customers to win back."
        />
      </div>
      <SelectField
        label="Bought from category"
        name="categoryId"
        defaultValue={value?.categoryId ?? ""}
        options={[
          { value: "", label: "Any" },
          ...categories.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
    </>
  );
}
