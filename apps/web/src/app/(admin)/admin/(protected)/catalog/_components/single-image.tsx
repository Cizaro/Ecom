import { MAX_UPLOAD_BYTES, type StoredImage } from "@ecom/core";
import { Card } from "@ecom/ui";
import { viewOf } from "@/server/media";
import type { FormState } from "../../../actions";
import { DangerForm } from "../../../_components/form";
import { ImageUploader } from "../../../_components/image-uploader";
import { MediaImage } from "../../../_components/media-image";

type Action = (previous: FormState, formData: FormData) => Promise<FormState>;

/** A card for the one image that belongs to a record: a category image or a brand logo. */
export function SingleImage({
  title,
  description,
  noun,
  id,
  image,
  alt,
  setAction,
  removeAction,
}: {
  title: string;
  description: string;
  /** "image" or "logo", used in button labels. */
  noun: string;
  id: string;
  image: StoredImage | null;
  alt: string;
  setAction: Action;
  removeAction: Action;
}) {
  return (
    <Card title={title} description={description}>
      {image ? (
        <div data-testid="single-image">
          <MediaImage
            image={viewOf(image)}
            alt={alt}
            sizes="240px"
            className="max-h-60 w-full max-w-60 rounded-control border border-line"
          />
        </div>
      ) : (
        <p className="text-sm text-ink-muted" data-testid="single-image-empty">
          No {noun} yet.
        </p>
      )}
      <ImageUploader
        action={setAction}
        fields={{ id }}
        label={image ? `Replace the ${noun}` : `Choose the ${noun}`}
        submitLabel={image ? `Replace ${noun}` : `Upload ${noun}`}
        maxBytes={MAX_UPLOAD_BYTES}
      />
      {image ? (
        <DangerForm
          action={removeAction}
          submitLabel={`Remove ${noun}`}
          confirmMessage={`Remove the ${noun}? This cannot be undone.`}
        >
          <input type="hidden" name="id" value={id} />
        </DangerForm>
      ) : null}
    </Card>
  );
}
