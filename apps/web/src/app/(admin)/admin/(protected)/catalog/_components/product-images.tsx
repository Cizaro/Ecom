import { MAX_PRODUCT_IMAGES, MAX_UPLOAD_BYTES, type ProductImageDetail } from "@ecom/core";
import { Badge, Card, EmptyState } from "@ecom/ui";
import { viewOf } from "@/server/media";
import { ActionForm, DangerForm, SelectField, TextField } from "../../../_components/form";
import { ImageUploader } from "../../../_components/image-uploader";
import { MediaImage } from "../../../_components/media-image";
import {
  moveProductImageAction,
  removeProductImageAction,
  updateProductImageAction,
  uploadProductImageAction,
} from "../actions";

const STATUS_NOTE: Record<ProductImageDetail["image"]["status"], string | null> = {
  processing: "Smaller versions are being prepared.",
  ready: null,
  failed: "Smaller versions could not be made, so the full-size image is used.",
};

/** The images card on a product page: upload, describe, order and remove. */
export function ProductImages({
  productId,
  images,
  variants,
  canWrite,
}: {
  productId: string;
  images: readonly ProductImageDetail[];
  variants: readonly { id: string; sku: string; color: string | null; size: string | null }[];
  canWrite: boolean;
}) {
  const variantOptions = [
    { value: "", label: "All variants" },
    ...variants.map((variant) => ({
      value: variant.id,
      label: [variant.sku, variant.color, variant.size].filter(Boolean).join(" · "),
    })),
  ];
  const variantLabel = new Map(variantOptions.map((option) => [option.value, option.label]));
  const full = images.length >= MAX_PRODUCT_IMAGES;

  return (
    <Card
      title="Images"
      description="The first image is the main one: it is shown in product lists and shared links."
    >
      {images.length === 0 ? (
        <EmptyState title="No images yet">
          {canWrite ? "Add clear, well-lit pictures. Shoppers decide with their eyes." : null}
        </EmptyState>
      ) : (
        <ul data-testid="image-list" className="grid gap-4 sm:grid-cols-2">
          {images.map((item, index) => (
            <li
              key={item.id}
              data-testid="image-item"
              className="flex min-w-0 flex-col gap-3 rounded-card border border-line p-3"
            >
              <MediaImage
                image={viewOf(item.image)}
                alt={item.altText}
                sizes="(min-width: 640px) 320px, 90vw"
                className="aspect-square w-full rounded-control"
              />
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <span>
                  Image {index + 1} of {images.length}
                </span>
                {item.isMain ? <Badge tone="success">Main image</Badge> : null}
                {item.altText === "" ? <Badge tone="warning">No description</Badge> : null}
              </div>
              {STATUS_NOTE[item.image.status] ? (
                <p className="text-sm text-ink-muted">{STATUS_NOTE[item.image.status]}</p>
              ) : null}

              {canWrite ? (
                <>
                  <ActionForm action={updateProductImageAction} submitLabel="Save image">
                    <input type="hidden" name="id" value={item.id} />
                    <TextField
                      id={`altText-${item.id}`}
                      label="Description"
                      name="altText"
                      hint="What the picture shows, for people who cannot see it and for search engines."
                      maxLength={300}
                      defaultValue={item.altText}
                    />
                    {variants.length > 0 ? (
                      <SelectField
                        id={`variantId-${item.id}`}
                        label="Shows"
                        name="variantId"
                        defaultValue={item.variantId ?? ""}
                        options={variantOptions}
                      />
                    ) : null}
                  </ActionForm>
                  <div className="flex flex-wrap items-start gap-2">
                    {index > 0 ? (
                      <>
                        <ActionForm
                          action={moveProductImageAction}
                          submitLabel="Make main"
                          submitTone="secondary"
                        >
                          <input type="hidden" name="id" value={item.id} />
                          <input type="hidden" name="move" value="first" />
                        </ActionForm>
                        <ActionForm
                          action={moveProductImageAction}
                          submitLabel="Move earlier"
                          submitTone="secondary"
                        >
                          <input type="hidden" name="id" value={item.id} />
                          <input type="hidden" name="move" value="earlier" />
                        </ActionForm>
                      </>
                    ) : null}
                    {index < images.length - 1 ? (
                      <ActionForm
                        action={moveProductImageAction}
                        submitLabel="Move later"
                        submitTone="secondary"
                      >
                        <input type="hidden" name="id" value={item.id} />
                        <input type="hidden" name="move" value="later" />
                      </ActionForm>
                    ) : null}
                    <DangerForm
                      action={removeProductImageAction}
                      submitLabel="Remove"
                      confirmMessage="Remove this image? This cannot be undone."
                    >
                      <input type="hidden" name="id" value={item.id} />
                    </DangerForm>
                  </div>
                </>
              ) : (
                <dl className="text-sm">
                  <dt className="font-medium">Description</dt>
                  <dd className="text-ink-muted">{item.altText || "None"}</dd>
                  {item.variantId ? (
                    <>
                      <dt className="mt-2 font-medium">Shows</dt>
                      <dd className="text-ink-muted">{variantLabel.get(item.variantId)}</dd>
                    </>
                  ) : null}
                </dl>
              )}
            </li>
          ))}
        </ul>
      )}

      {canWrite ? (
        full ? (
          <p className="text-sm text-ink-muted">
            This product has the most images allowed ({MAX_PRODUCT_IMAGES}). Remove one to add
            another.
          </p>
        ) : (
          <ImageUploader
            action={uploadProductImageAction}
            fields={{ productId }}
            label="Add images"
            submitLabel="Upload"
            multiple
            maxBytes={MAX_UPLOAD_BYTES}
          />
        )
      ) : null}
    </Card>
  );
}
