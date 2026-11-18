import { listLibrary } from "@ecom/core";
import { Badge, Card, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { MediaImage } from "@/components/media-image";
import { requirePermission, tenantDb } from "@/server/access";
import { viewOf } from "@/server/media";
import { ActionForm, CheckboxField, TextField } from "../../../_components/form";
import { addLibraryFileAction, updateLibraryFileAction } from "../actions";

export const metadata: Metadata = { title: "Content library" };

type Params = Record<string, string | string[] | undefined>;
const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

// The store's photos and videos for marketing, with who owns each one and
// the permission to use it.
export default async function LibraryPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { context } = await requirePermission("content.write");
  const params = await searchParams;
  const archived = first(params.archived) === "1";
  const tag = first(params.tag) ?? "";
  const items = await listLibrary(tenantDb(context), context, { archived, tag });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Content library"
        description={
          <>
            Photos and videos for your posts, with a note of who owns each one and your permission
            to use it.{" "}
            <Link href="/admin/marketing/posts" className="underline underline-offset-4">
              Posts
            </Link>
            {" · "}
            <Link href="/admin/marketing/calendar" className="underline underline-offset-4">
              Calendar
            </Link>
          </>
        }
      />

      <Card title="Add a photo or video">
        <ActionForm
          action={addLibraryFileAction}
          submitLabel="Add to library"
          testId="library-upload"
        >
          <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="library-file">
            Photo or video
            <input
              id="library-file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
              className="text-sm font-normal"
            />
            <span className="font-normal text-ink-muted">
              JPEG, PNG, WebP, MP4 or MOV, 8 MB at most.
            </span>
          </label>
          <TextField label="Title" name="title" maxLength={120} />
          <TextField
            label="Tags"
            name="tags"
            hint="Optional, separated by commas: summer, totes"
            maxLength={500}
          />
          <TextField
            label="Description for people who cannot see it"
            name="altText"
            maxLength={300}
            hint="Optional."
          />
          <TextField
            label="Who owns it, and your permission to use it"
            name="usageNote"
            maxLength={500}
            hint='For example "Our own photo" or "Creator @name, by Instagram message on 12 November".'
          />
        </ActionForm>
      </Card>

      <div className="flex flex-wrap gap-3 text-sm">
        <Link
          href={archived ? "/admin/marketing/library" : "/admin/marketing/library?archived=1"}
          className="underline underline-offset-4"
        >
          {archived ? "Show the library" : "Show archived files"}
        </Link>
        {tag ? (
          <span>
            Tag: <Badge tone="neutral">{tag}</Badge>{" "}
            <Link href="/admin/marketing/library" className="underline underline-offset-4">
              Clear
            </Link>
          </span>
        ) : null}
      </div>

      {items.length === 0 ? (
        <EmptyState title={archived ? "No archived files" : "No photos or videos yet"} />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="library-items">
          {items.map((item) => {
            const view = viewOf(item.media);
            return (
              <li key={item.id} className="flex flex-col gap-3 rounded-card border border-line p-3">
                <div className="aspect-square overflow-hidden rounded-control bg-surface-muted">
                  {item.kind === "video" ? (
                    <video
                      src={view.url}
                      muted
                      playsInline
                      controls
                      preload="metadata"
                      className="size-full object-cover"
                    />
                  ) : (
                    <MediaImage
                      image={view}
                      alt={item.altText}
                      sizes="300px"
                      className="size-full object-cover"
                    />
                  )}
                </div>
                <p className="truncate font-medium">{item.title}</p>
                {item.derivedFrom ? (
                  <p className="text-xs text-ink-muted">
                    Version of{" "}
                    <Link
                      href={`/admin/marketing/library/${item.derivedFrom.id}`}
                      className="underline underline-offset-4"
                    >
                      {item.derivedFrom.title}
                    </Link>
                  </p>
                ) : null}
                {item.kind === "image" ? (
                  <Link
                    href={`/admin/marketing/library/${item.id}`}
                    className="text-sm underline underline-offset-4"
                  >
                    Sizes and versions{item.versionCount ? ` (${item.versionCount})` : ""}
                  </Link>
                ) : null}
                <div className="flex flex-wrap gap-1 text-xs">
                  <Badge tone="neutral">{item.kind === "video" ? "Video" : "Photo"}</Badge>
                  {item.tags.map((t) => (
                    <Link key={t} href={`/admin/marketing/library?tag=${encodeURIComponent(t)}`}>
                      <Badge tone="neutral">{t}</Badge>
                    </Link>
                  ))}
                  {item.postCount > 0 ? (
                    <Badge tone="success">In {item.postCount} posts</Badge>
                  ) : null}
                </div>
                {item.usageNote ? (
                  <p className="text-xs text-ink-muted">Rights: {item.usageNote}</p>
                ) : (
                  <p className="text-xs text-warning-ink">No rights note yet.</p>
                )}
                <ActionForm
                  action={updateLibraryFileAction}
                  submitLabel="Save"
                  submitTone="secondary"
                >
                  <input type="hidden" name="id" value={item.id} />
                  <TextField
                    id={`title-${item.id}`}
                    label="Title"
                    name="title"
                    defaultValue={item.title}
                    maxLength={120}
                  />
                  <TextField
                    id={`tags-${item.id}`}
                    label="Tags"
                    name="tags"
                    defaultValue={item.tags.join(", ")}
                  />
                  <TextField
                    id={`alt-${item.id}`}
                    label="Description"
                    name="altText"
                    defaultValue={item.altText}
                    maxLength={300}
                  />
                  <TextField
                    id={`rights-${item.id}`}
                    label="Rights"
                    name="usageNote"
                    defaultValue={item.usageNote}
                    maxLength={500}
                  />
                  <CheckboxField
                    id={`archived-${item.id}`}
                    label="Archived (hidden from new posts)"
                    name="archived"
                    defaultChecked={item.archived}
                  />
                </ActionForm>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
