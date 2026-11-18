import { POST_CHANNELS, POST_FORMATS, type LibraryItem } from "@ecom/core";
import { MediaImage } from "@/components/media-image";
import { viewOf } from "@/server/media";
import { SelectField, TextAreaField, TextField } from "../../../_components/form";
import { CHANNEL_LABEL, FORMAT_LABEL } from "../labels";

/** The fields of the post form: what, where, when, the caption, files and products. */
export function PostFields({
  files,
  products,
  value,
}: {
  files: LibraryItem[];
  products: { id: string; name: string; published: boolean }[];
  value?: {
    title: string;
    channel: string;
    format: string;
    caption: string;
    plannedFor: string;
    fileIds: string[];
    productIds: string[];
  };
}) {
  return (
    <>
      <TextField
        label="Name (for your team)"
        name="title"
        maxLength={120}
        defaultValue={value?.title}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <SelectField
          label="Where"
          name="channel"
          defaultValue={value?.channel ?? "instagram"}
          options={POST_CHANNELS.map((channel) => ({
            value: channel,
            label: CHANNEL_LABEL[channel],
          }))}
        />
        <SelectField
          label="Kind"
          name="format"
          defaultValue={value?.format ?? "post"}
          options={POST_FORMATS.map((format) => ({ value: format, label: FORMAT_LABEL[format] }))}
        />
        <TextField
          label="Planned for"
          name="plannedFor"
          type="datetime-local"
          hint="In your store's time zone. Optional."
          defaultValue={value?.plannedFor}
        />
      </div>
      <TextAreaField
        id="caption"
        label="Caption"
        name="caption"
        rows={6}
        maxLength={5000}
        defaultValue={value?.caption}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Photos and videos</legend>
        {files.length === 0 ? (
          <p className="text-sm text-ink-muted">Add some to the content library first.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6" data-testid="post-file-picker">
            {files.map((file) => (
              <label key={file.id} className="flex flex-col gap-1 text-xs">
                <span className="aspect-square overflow-hidden rounded-control bg-surface-muted">
                  {file.kind === "video" ? (
                    <span className="flex size-full items-center justify-center">Video</span>
                  ) : (
                    <MediaImage
                      image={viewOf(file.media)}
                      alt=""
                      sizes="120px"
                      className="size-full object-cover"
                    />
                  )}
                </span>
                <span className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    name="fileIds"
                    value={file.id}
                    defaultChecked={value?.fileIds.includes(file.id)}
                    className="size-4 accent-brand"
                  />
                  <span className="truncate">{file.title}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Products it features</legend>
        <div
          className="flex max-h-56 flex-col gap-1 overflow-y-auto rounded-control border border-line p-2 text-sm"
          data-testid="post-product-picker"
        >
          {products.map((product) => (
            <label key={product.id} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="productIds"
                value={product.id}
                defaultChecked={value?.productIds.includes(product.id)}
                className="size-4 accent-brand"
              />
              {product.name}
              {product.published ? null : <span className="text-ink-muted">(draft)</span>}
            </label>
          ))}
        </div>
      </fieldset>
    </>
  );
}
