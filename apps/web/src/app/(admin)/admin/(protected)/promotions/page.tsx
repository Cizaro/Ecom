import {
  describeDiscount,
  discountFormValues,
  formatMoney,
  listDiscountCodes,
  type DiscountCodeView,
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
} from "../../_components/form";
import {
  createDiscountCodeAction,
  deleteDiscountCodeAction,
  updateDiscountCodeAction,
} from "./actions";

export const metadata: Metadata = { title: "Discount codes" };

const KINDS = [
  { value: "percent", label: "Percent off the items" },
  { value: "fixed", label: "Amount off the items" },
  { value: "free_delivery", label: "Free delivery" },
] as const;

export default async function DiscountCodesPage() {
  const { context } = await requirePermission("promotions.write");
  const { codes, currency, timeZone } = await listDiscountCodes(tenantDb(context), context);
  const day = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone });

  const status = (code: DiscountCodeView) => {
    const now = new Date();
    if (!code.isActive) return "Off";
    if (code.startsAt && code.startsAt > now) return `Starts ${day.format(code.startsAt)}`;
    if (code.endsAt && code.endsAt <= now) return "Ended";
    if (code.usageLimit !== null && code.used >= code.usageLimit) return "Used up";
    return "Active";
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Discount codes"
        description="Codes shoppers type at checkout. Each is checked again when the order is placed. Uses are counted from orders; a cancelled order gives its use back."
      />

      <Card title="Codes">
        {codes.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="no-codes">
            No discount codes yet.
          </p>
        ) : (
          <List testId="code-list">
            {codes.map((code) => {
              const values = discountFormValues(code, timeZone);
              const state = status(code);
              return (
                <ListItem key={code.id} testId="code-row">
                  <div className="flex w-full flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-mono font-medium">{code.code}</span>
                      <span data-testid="code-summary">{describeDiscount(code)}</span>
                      <Badge tone={state === "Active" ? "success" : "neutral"}>{state}</Badge>
                      <span className="text-ink-muted" data-testid="code-used">
                        Used {code.used}
                        {code.usageLimit !== null ? ` of ${code.usageLimit}` : ""}
                      </span>
                      {code.minSubtotal !== null ? (
                        <span className="text-ink-muted">
                          Minimum {formatMoney(code.minSubtotal, code.currency)}
                        </span>
                      ) : null}
                      {code.endsAt ? (
                        <span className="text-ink-muted">
                          Last day {day.format(new Date(code.endsAt.getTime() - 1))}
                        </span>
                      ) : null}
                    </div>
                    <details>
                      <summary className="cursor-pointer text-sm underline underline-offset-4">
                        Edit {code.code}
                      </summary>
                      <div className="mt-3 flex flex-col gap-3">
                        <ActionForm
                          action={updateDiscountCodeAction}
                          submitLabel="Save"
                          submitTone="secondary"
                          testId="code-edit-form"
                        >
                          <input type="hidden" name="id" value={code.id} />
                          <CodeFields
                            idPrefix={code.id}
                            currency={code.currency}
                            code={code.code}
                            kind={code.kind}
                            isActive={code.isActive}
                            {...values}
                          />
                        </ActionForm>
                        {code.used === 0 ? (
                          <DangerForm
                            action={deleteDiscountCodeAction}
                            submitLabel="Delete code"
                            confirmMessage={`Delete the discount code ${code.code}?`}
                          >
                            <input type="hidden" name="id" value={code.id} />
                          </DangerForm>
                        ) : (
                          <p className="text-sm text-ink-muted">
                            Orders have used this code, so it is kept. Untick &ldquo;Can be
                            used&rdquo; to switch it off.
                          </p>
                        )}
                      </div>
                    </details>
                  </div>
                </ListItem>
              );
            })}
          </List>
        )}
      </Card>

      <Card title="Add a discount code">
        <ActionForm
          action={createDiscountCodeAction}
          submitLabel="Add code"
          testId="code-create-form"
        >
          <CodeFields idPrefix="new" currency={currency} isActive />
        </ActionForm>
      </Card>
    </div>
  );
}

function CodeFields(props: {
  idPrefix: string;
  currency: string;
  code?: string;
  kind?: string;
  value?: string;
  minSubtotal?: string;
  startsOn?: string;
  endsOn?: string;
  usageLimit?: string;
  perCustomerLimit?: string;
  isActive: boolean;
}) {
  const id = (name: string) => `${name}-${props.idPrefix}`;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={id("code")}
          label="Code"
          name="code"
          maxLength={40}
          autoComplete="off"
          hint="Letters, digits, - or _, such as SUMMER10"
          defaultValue={props.code}
        />
        <SelectField
          id={id("kind")}
          label="Gives"
          name="kind"
          defaultValue={props.kind ?? "percent"}
          options={KINDS}
        />
        <TextField
          id={id("value")}
          label={`Percent or amount (${props.currency})`}
          name="value"
          inputMode="decimal"
          hint="10 for 10% off, or 5.00 for $5 off. Empty for free delivery."
          defaultValue={props.value}
        />
        <TextField
          id={id("minSubtotal")}
          label={`Minimum order (${props.currency})`}
          name="minSubtotal"
          inputMode="decimal"
          hint="Optional"
          defaultValue={props.minSubtotal}
        />
        <TextField
          id={id("startsOn")}
          label="First day"
          name="startsOn"
          type="date"
          hint="Optional"
          defaultValue={props.startsOn}
        />
        <TextField
          id={id("endsOn")}
          label="Last day"
          name="endsOn"
          type="date"
          hint="Optional"
          defaultValue={props.endsOn}
        />
        <TextField
          id={id("usageLimit")}
          label="Uses in total"
          name="usageLimit"
          inputMode="numeric"
          hint="Optional"
          defaultValue={props.usageLimit}
        />
        <TextField
          id={id("perCustomerLimit")}
          label="Uses per customer"
          name="perCustomerLimit"
          inputMode="numeric"
          hint="Optional, by email address"
          defaultValue={props.perCustomerLimit}
        />
      </div>
      <CheckboxField
        id={id("isActive")}
        label="Can be used"
        name="isActive"
        defaultChecked={props.isActive}
      />
    </>
  );
}
