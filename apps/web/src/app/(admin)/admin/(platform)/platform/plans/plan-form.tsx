import { moneyToInput, type Plan } from "@ecom/core";
import {
  ActionForm,
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from "../../../_components/form";
import { savePlanAction } from "../billing-actions";

const CURRENCIES = ["USD", "EUR", "LBP"].map((c) => ({ value: c, label: c }));

/** Create or change a plan. Prices are what you type; nothing is filled in for you. */
export function PlanForm({ plan }: { plan?: Plan }) {
  return (
    <ActionForm
      action={savePlanAction}
      submitLabel={plan ? "Save plan" : "Create plan"}
      testId="plan-form"
    >
      {plan ? <input type="hidden" name="id" value={plan.id} /> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          label="Name"
          name="name"
          required
          maxLength={60}
          defaultValue={plan?.name}
          hint="Shown to shop owners, e.g. Starter."
        />
        <TextField
          label="Key"
          name="key"
          required
          maxLength={30}
          defaultValue={plan?.key}
          hint="Lower-case, e.g. starter. Stored on each shop."
        />
        <TextField
          label="Monthly price"
          name="price"
          required
          inputMode="decimal"
          defaultValue={plan ? moneyToInput(plan.priceAmount, plan.currency) : undefined}
          hint="e.g. 25 or 24.99"
        />
        <SelectField
          label="Currency"
          name="currency"
          options={CURRENCIES}
          defaultValue={plan?.currency ?? "USD"}
        />
        <TextField
          label="Products included"
          name="productLimit"
          inputMode="numeric"
          defaultValue={plan?.productLimit?.toString()}
          hint="Leave empty for no limit."
        />
        <TextField
          label="Staff accounts included"
          name="staffLimit"
          inputMode="numeric"
          defaultValue={plan?.staffLimit?.toString()}
          hint="Leave empty for no limit."
        />
        <TextField
          label="AI included per month (USD)"
          name="aiBudget"
          inputMode="decimal"
          defaultValue={
            plan?.aiMonthlyBudgetAmount != null
              ? moneyToInput(plan.aiMonthlyBudgetAmount, "USD")
              : undefined
          }
          hint="Becomes the shop's AI spending cap. Leave empty to keep each shop's own."
        />
        <TextField
          label="Order on the pricing page"
          name="sortOrder"
          inputMode="numeric"
          defaultValue={plan?.sortOrder.toString() ?? "0"}
        />
      </div>
      <TextAreaField
        label="What is included (one line each)"
        name="description"
        rows={4}
        maxLength={500}
        defaultValue={plan?.description}
      />
      <CheckboxField
        label="Show on the public pricing page"
        name="isPublic"
        defaultChecked={plan?.isPublic ?? true}
      />
    </ActionForm>
  );
}
