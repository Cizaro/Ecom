import { TextAreaField, TextField } from "../../_components/form";

export interface CompetitorFormValue {
  name: string;
  website: string;
  instagram: string;
  facebook: string;
  tiktok: string;
  tags: string;
  notes: string;
}

/** Who the competitor is and where to find them. */
export function CompetitorFields({ value }: { value?: CompetitorFormValue }) {
  return (
    <>
      <TextField label="Name" name="name" maxLength={120} defaultValue={value?.name} />
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Website" name="website" defaultValue={value?.website} hint="Optional." />
        <TextField
          label="Facebook page"
          name="facebook"
          defaultValue={value?.facebook}
          hint="Optional, the page's address."
        />
        <TextField
          label="Instagram"
          name="instagram"
          defaultValue={value?.instagram}
          hint="Optional, like @name."
        />
        <TextField label="TikTok" name="tiktok" defaultValue={value?.tiktok} hint="Optional." />
      </div>
      <TextField
        label="Tags"
        name="tags"
        defaultValue={value?.tags}
        hint="Optional, separated by commas: bags, Beirut, online only"
      />
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
