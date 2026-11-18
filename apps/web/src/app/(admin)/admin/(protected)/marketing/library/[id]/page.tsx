import {
  EDIT_BACKGROUNDS,
  EDIT_POSITIONS,
  EDIT_SIZES,
  EDIT_STEPS,
  getLibraryFile,
  listVersions,
  type EditBackground,
  type EditPosition,
} from "@ecom/core";
import { Card, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { MediaImage } from "@/components/media-image";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { viewOf } from "@/server/media";
import { ActionForm, CheckboxField, SelectField } from "../../../../_components/form";
import { makeVersionAction } from "../../actions";

export const metadata: Metadata = { title: "Sizes and versions" };

const BACKGROUND_LABEL: Record<EditBackground, string> = {
  white: "White",
  light: "Light grey",
  black: "Black",
  blur: "Blurred copy of the photo",
  transparent: "Transparent (PNG)",
};

const POSITION_LABEL: Record<EditPosition, string> = {
  smart: "The busiest part (automatic)",
  centre: "The centre",
  top: "The top",
  bottom: "The bottom",
};

const percent = (n: number) => ({
  value: String(n),
  label: n === 0 ? "No change" : `${n > 0 ? "+" : ""}${n}%`,
});

// One library photo: make a version for a platform (its size, light
// correction, a plain background removed) and see the versions made.
export default async function LibraryFilePage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("content.write");
  const { id } = await params;
  const db = tenantDb(context);
  const file = await orNotFound(getLibraryFile(db, context, id));
  const versions = file.kind === "image" ? await listVersions(db, context, id) : [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={file.title}
        description={
          <>
            {file.media.width} × {file.media.height}
            {file.editNote ? ` · ${file.editNote}` : ""}
            {" · "}
            <Link href="/admin/marketing/library" className="underline underline-offset-4">
              Library
            </Link>
            {file.derivedFrom ? (
              <>
                {" · Version of "}
                <Link
                  href={`/admin/marketing/library/${file.derivedFrom.id}`}
                  className="underline underline-offset-4"
                >
                  {file.derivedFrom.title}
                </Link>
              </>
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="overflow-hidden rounded-card border border-line bg-surface-muted">
          {file.kind === "video" ? (
            <video src={viewOf(file.media).url} controls muted playsInline className="w-full" />
          ) : (
            <MediaImage
              image={viewOf(file.media)}
              alt={file.altText}
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="h-auto w-full"
            />
          )}
        </div>

        {file.kind === "image" ? (
          <Card
            title="Make a version"
            description="Added to the library as a new file with the same tags and rights note. The original is not changed."
          >
            <ActionForm action={makeVersionAction} submitLabel="Make version" testId="version-form">
              <input type="hidden" name="id" value={file.id} />
              <SelectField
                label="For"
                name="size"
                defaultValue="instagram_square"
                options={Object.entries(EDIT_SIZES).map(([value, size]) => ({
                  value,
                  label: size.width ? `${size.label} (${size.width} × ${size.height})` : size.label,
                }))}
              />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Fit"
                  name="fit"
                  defaultValue="fill"
                  options={[
                    { value: "fill", label: "Crop to fill the frame" },
                    { value: "whole", label: "Whole photo, with a background around it" },
                  ]}
                />
                <SelectField
                  label="When cropping, keep"
                  name="position"
                  defaultValue="smart"
                  options={EDIT_POSITIONS.map((value) => ({ value, label: POSITION_LABEL[value] }))}
                />
              </div>
              <SelectField
                label="Background"
                name="background"
                defaultValue="white"
                hint="Around the whole photo, and behind the product when its background is removed."
                options={EDIT_BACKGROUNDS.map((value) => ({
                  value,
                  label: BACKGROUND_LABEL[value],
                }))}
              />
              <CheckboxField
                label="Remove a plain background"
                name="removeBackground"
                hint="For products photographed on a plain wall, floor or sheet. Busy backgrounds are not removed."
              />
              <CheckboxField label="Correct the light automatically" name="autoLight" />
              <div className="grid gap-4 sm:grid-cols-2">
                <SelectField
                  label="Brightness"
                  name="brightness"
                  defaultValue="0"
                  options={EDIT_STEPS.map(percent)}
                />
                <SelectField
                  label="Colour strength"
                  name="saturation"
                  defaultValue="0"
                  options={EDIT_STEPS.map(percent)}
                />
              </div>
              <CheckboxField label="Sharpen slightly" name="sharpen" />
              <p className="text-xs text-ink-muted">
                Changes are kept small so the product looks as it really is.
              </p>
            </ActionForm>
          </Card>
        ) : (
          <Card title="Video">
            <p className="text-sm text-ink-muted">Versions can be made from photos only.</p>
          </Card>
        )}
      </div>

      {file.kind === "image" ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">Versions</h2>
          {versions.length === 0 ? (
            <EmptyState title="No versions yet" />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" data-testid="versions">
              {versions.map((version) => (
                <li
                  key={version.id}
                  className="flex flex-col gap-2 rounded-card border border-line p-3"
                >
                  <a
                    href={viewOf(version.media).url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-control bg-surface-muted"
                  >
                    <MediaImage
                      image={viewOf(version.media)}
                      alt={version.altText}
                      sizes="300px"
                      className="h-auto w-full"
                    />
                  </a>
                  <p className="truncate text-sm font-medium">{version.title}</p>
                  <p className="text-xs text-ink-muted">{version.editNote}</p>
                  <a
                    href={viewOf(version.media).url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm underline underline-offset-4"
                  >
                    Open full size
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}
