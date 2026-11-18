import { CAMPAIGN_CHANNELS, CAMPAIGN_OBJECTIVES, CAMPAIGN_STATUSES } from "@ecom/core";
import { SelectField, TextAreaField, TextField } from "../../../_components/form";
import { CAMPAIGN_CHANNEL_LABEL, CAMPAIGN_STATUS_LABEL, OBJECTIVE_LABEL } from "../labels";

export interface CampaignFormValue {
  name: string;
  objective: string;
  status: string;
  startsOn: string;
  endsOn: string;
  channels: string[];
  audience: string;
  keyMessage: string;
  offer: string;
  budget: string;
  discountCodeId: string;
  segmentId: string;
  notes: string;
  productIds: string[];
}

/** The campaign brief: what, when, where, for whom, the message and the offer. */
export function CampaignFields({
  choices,
  value,
  currency,
}: {
  choices: {
    codes: { id: string; code: string }[];
    segments: { id: string; name: string }[];
    products: { id: string; name: string }[];
  };
  value?: CampaignFormValue;
  currency: string;
}) {
  return (
    <>
      <TextField label="Campaign name" name="name" maxLength={120} defaultValue={value?.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <SelectField
          label="Goal"
          name="objective"
          defaultValue={value?.objective ?? "sales"}
          options={CAMPAIGN_OBJECTIVES.map((o) => ({ value: o, label: OBJECTIVE_LABEL[o] }))}
        />
        <SelectField
          label="Status"
          name="status"
          defaultValue={value?.status ?? "planned"}
          options={CAMPAIGN_STATUSES.map((s) => ({ value: s, label: CAMPAIGN_STATUS_LABEL[s] }))}
        />
        <TextField label="Starts" name="startsOn" type="date" defaultValue={value?.startsOn} />
        <TextField
          label="Ends"
          name="endsOn"
          type="date"
          hint="Optional."
          defaultValue={value?.endsOn}
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Channels</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
          {CAMPAIGN_CHANNELS.map((channel) => (
            <label key={channel} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="channels"
                value={channel}
                defaultChecked={value?.channels.includes(channel)}
                className="size-4 accent-brand"
              />
              {CAMPAIGN_CHANNEL_LABEL[channel]}
            </label>
          ))}
        </div>
      </fieldset>
      <TextAreaField
        label="Who it is for"
        name="audience"
        rows={2}
        maxLength={1000}
        defaultValue={value?.audience}
        hint="For example: women 20 to 35 in Beirut who like the beach."
      />
      <TextAreaField
        label="Key message"
        name="keyMessage"
        rows={2}
        maxLength={1000}
        defaultValue={value?.keyMessage}
      />
      <TextField
        label="Offer"
        name="offer"
        maxLength={500}
        defaultValue={value?.offer}
        hint="Only a real offer. No made-up deadlines or stock limits."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          label={`Planned budget (${currency})`}
          name="budget"
          inputMode="decimal"
          defaultValue={value?.budget}
          hint="For your planning only; nothing is spent from here."
        />
        <SelectField
          label="Discount code"
          name="discountCodeId"
          defaultValue={value?.discountCodeId ?? ""}
          hint="Orders using it while the campaign runs are counted."
          options={[
            { value: "", label: "None" },
            ...choices.codes.map((c) => ({ value: c.id, label: c.code })),
          ]}
        />
        <SelectField
          label="Customer segment"
          name="segmentId"
          defaultValue={value?.segmentId ?? ""}
          options={[
            { value: "", label: "None" },
            ...choices.segments.map((s) => ({ value: s.id, label: s.name })),
          ]}
        />
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Products it features</legend>
        <div
          className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded-control border border-line p-2 text-sm"
          data-testid="campaign-product-picker"
        >
          {choices.products.map((product) => (
            <label key={product.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="productIds"
                value={product.id}
                defaultChecked={value?.productIds.includes(product.id)}
                className="size-4 accent-brand"
              />
              {product.name}
            </label>
          ))}
        </div>
      </fieldset>
      <TextAreaField
        label="Notes"
        name="notes"
        rows={3}
        maxLength={2000}
        defaultValue={value?.notes}
      />
    </>
  );
}
