import {
  hasPermission,
  listProducts,
  listUgcForModeration,
  UGC_STATUSES,
  type UgcStatus,
} from "@ecom/core";
import { Badge, Card, EmptyState, inputClasses, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { MediaImage } from "@/components/media-image";
import { requirePermission, tenantDb } from "@/server/access";
import { ugcView } from "@/server/media";
import {
  ActionForm,
  CheckboxField,
  DangerForm,
  SelectField,
  TextAreaField,
  TextField,
} from "../../_components/form";
import { addStaffUgcAction, moderateUgcAction, removeUgcAction } from "./actions";

export const metadata: Metadata = { title: "Customer photos" };

const FILTERS: { value: UgcStatus; label: string }[] = [
  { value: "pending", label: "Waiting" },
  { value: "approved", label: "Shown" },
  { value: "hidden", label: "Hidden" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Permission withdrawn" },
  { value: "removed", label: "Removed" },
];

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export default async function ContentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await requirePermission("reviews.moderate");
  const params = await searchParams;
  const status = UGC_STATUSES.find((value) => value === first(params.status)) ?? "pending";
  const db = tenantDb(context);
  const canAdd = hasPermission(context, "content.write");
  const [result, products] = await Promise.all([
    listUgcForModeration(db, context, { status }),
    canAdd && hasPermission(context, "catalog.read")
      ? listProducts(db, context, { page: 1 }).then((list) => list.items)
      : Promise.resolve([]),
  ]);
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Customer photos"
        description={`Photos and videos from customers and creators, shown only with their permission and after you approve them. ${result.pending} waiting.`}
      />
      <nav aria-label="Filters" className="flex flex-wrap gap-2 text-sm">
        {FILTERS.map((filter) => (
          <Link
            key={filter.value}
            href={`/admin/content?status=${filter.value}`}
            aria-current={status === filter.value ? "page" : undefined}
            className={`rounded-control border px-3 py-1 ${status === filter.value ? "border-ink font-medium" : "border-line"}`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {result.items.length === 0 ? (
        <EmptyState title="Nothing here" />
      ) : (
        <List testId="ugc-moderation">
          {result.items.map((item) => {
            const view = item.media ? ugcView(item.media) : null;
            const live = item.status !== "withdrawn" && item.status !== "removed";
            return (
              <ListItem key={item.id} testId="ugc-moderation-row">
                <div className="flex w-full flex-col gap-3 text-sm sm:flex-row">
                  <div className="h-40 w-32 shrink-0 overflow-hidden rounded-control bg-surface-muted">
                    {view?.kind === "image" ? (
                      <MediaImage
                        image={view.image}
                        alt=""
                        sizes="128px"
                        className="h-full w-full object-cover"
                      />
                    ) : view?.kind === "video" ? (
                      <video
                        src={view.url}
                        controls
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <span className="flex h-full items-center justify-center p-2 text-center text-ink-muted">
                        File deleted
                      </span>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{item.creditName}</span>
                      <Badge>{item.source === "customer" ? "Customer" : "Creator"}</Badge>
                      <Badge>{item.kind === "video" ? "Video" : "Photo"}</Badge>
                      {item.featured ? <Badge tone="success">Featured</Badge> : null}
                    </div>
                    {item.caption ? <p>{item.caption}</p> : null}
                    <p className="text-ink-muted">
                      {item.productName ? `${item.productName} · ` : ""}
                      {when.format(item.createdAt)}
                    </p>
                    <details className="text-ink-muted">
                      <summary className="cursor-pointer underline underline-offset-4">
                        Permission record
                      </summary>
                      <div className="mt-1 flex flex-col gap-1" data-testid="ugc-permission">
                        <p>
                          Given {when.format(item.permissionGrantedAt)}: &ldquo;
                          {item.permissionText}&rdquo;
                        </p>
                        {item.sourceUrl ? (
                          <p className="break-all">
                            First posted at{" "}
                            <a
                              href={item.sourceUrl}
                              target="_blank"
                              rel="noopener noreferrer nofollow"
                              className="underline"
                            >
                              {item.sourceUrl}
                            </a>
                          </p>
                        ) : null}
                        {item.permissionWithdrawnAt ? (
                          <p>Withdrawn {when.format(item.permissionWithdrawnAt)}</p>
                        ) : null}
                      </div>
                    </details>
                    {live ? (
                      <div className="flex flex-wrap gap-2">
                        {(["approved", "hidden", "rejected"] as const)
                          .filter((next) => next !== item.status)
                          .map((next) => (
                            <ActionForm
                              key={next}
                              action={moderateUgcAction}
                              submitLabel={
                                next === "approved"
                                  ? "Approve"
                                  : next === "hidden"
                                    ? "Hide"
                                    : "Reject"
                              }
                              submitTone={next === "approved" ? undefined : "secondary"}
                            >
                              <input type="hidden" name="id" value={item.id} />
                              <input type="hidden" name="action" value={next} />
                            </ActionForm>
                          ))}
                        {item.status === "approved" ? (
                          <ActionForm
                            action={moderateUgcAction}
                            submitLabel={item.featured ? "Stop featuring" : "Feature"}
                            submitTone="secondary"
                          >
                            <input type="hidden" name="id" value={item.id} />
                            <input
                              type="hidden"
                              name="action"
                              value={item.featured ? "unfeature" : "feature"}
                            />
                          </ActionForm>
                        ) : null}
                        <DangerForm
                          action={removeUgcAction}
                          submitLabel="Remove for good"
                          confirmMessage="Remove this for good? The file is deleted; the permission record is kept."
                        >
                          <input type="hidden" name="id" value={item.id} />
                        </DangerForm>
                      </div>
                    ) : null}
                  </div>
                </div>
              </ListItem>
            );
          })}
        </List>
      )}

      {canAdd ? (
        <Card
          title="Add a creator's photo or video"
          description="Only content you have the creator's permission to use. Record where it was posted and how they agreed."
        >
          <ActionForm action={addStaffUgcAction} submitLabel="Add" testId="staff-ugc-form">
            <div className="flex flex-col gap-1">
              <label htmlFor="staff-ugc-file" className="text-sm font-medium">
                Photo or video
              </label>
              <input
                id="staff-ugc-file"
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                className={`${inputClasses} py-2`}
              />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Creator's name or handle"
                name="creditName"
                maxLength={60}
                hint="Shown with it, e.g. @maya.style"
              />
              <TextField
                label="Where it was posted"
                name="sourceUrl"
                type="url"
                hint="Link to the original post (https://...)"
              />
              <SelectField
                label="Product"
                name="productId"
                defaultValue=""
                options={[
                  { value: "", label: "None" },
                  ...products.map((p) => ({ value: p.id, label: p.name })),
                ]}
              />
              <TextField label="Caption" name="caption" maxLength={300} hint="Optional" />
            </div>
            <TextAreaField
              label="How permission was given"
              name="permissionNote"
              rows={2}
              maxLength={2000}
              hint="For example: by Instagram message on 12 November; screenshot saved."
            />
            <CheckboxField label="I have the creator's permission to show this" name="confirmed" />
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
