import { trackedUrl, type TrackingLink } from "@ecom/core";
import { EmptyState } from "@ecom/ui";
import Link from "next/link";
import { ActionForm, TextField } from "../../../_components/form";
import { createLinkAction, deleteLinkAction } from "../campaigns/actions";

const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/**
 * Tracking links with their click counts, and (for people who may make
 * them) a form for a new one tied to a campaign and/or a post.
 */
export function TrackingLinks({
  links,
  origin,
  canEdit,
  campaignId = "",
  postId = "",
  defaultSource = "instagram",
  showOwner = false,
}: {
  links: TrackingLink[];
  origin: string;
  canEdit: boolean;
  campaignId?: string;
  postId?: string;
  defaultSource?: string;
  showOwner?: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      {links.length === 0 ? (
        <EmptyState title="No tracking links yet" />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="tracking-links">
          {links.map((link) => {
            const short = `${origin}/go/${link.shortCode}`;
            return (
              <li
                key={link.id}
                className="flex flex-col gap-1 rounded-card border border-line p-3 text-sm"
                data-testid="tracking-link"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">{link.label}</span>
                  <span data-testid="link-clicks">
                    <strong>{link.clickCount}</strong> {link.clickCount === 1 ? "click" : "clicks"}
                    {link.lastClickedAt ? (
                      <span className="text-ink-muted">
                        {" "}
                        · last {dateTime.format(link.lastClickedAt)}
                      </span>
                    ) : null}
                  </span>
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-xs text-ink-muted">Short link to share</span>
                  <code className="break-all select-all" data-testid="short-link">
                    {short}
                  </code>
                </div>
                <details className="text-xs text-ink-muted">
                  <summary className="cursor-pointer">Full address with tags</summary>
                  <code className="break-all select-all">{trackedUrl(link, origin)}</code>
                </details>
                {showOwner && (link.campaign || link.post) ? (
                  <span className="text-xs text-ink-muted">
                    {link.campaign ? (
                      <>
                        Campaign{" "}
                        <Link
                          href={`/admin/marketing/campaigns/${link.campaign.id}`}
                          className="underline underline-offset-4"
                        >
                          {link.campaign.name}
                        </Link>
                      </>
                    ) : null}
                    {link.campaign && link.post ? " · " : null}
                    {link.post ? (
                      <>
                        Post{" "}
                        <Link
                          href={`/admin/marketing/posts/${link.post.id}`}
                          className="underline underline-offset-4"
                        >
                          {link.post.title}
                        </Link>
                      </>
                    ) : null}
                  </span>
                ) : null}
                {canEdit ? (
                  <ActionForm
                    action={deleteLinkAction}
                    submitLabel="Delete link"
                    submitTone="danger"
                  >
                    <input type="hidden" name="id" value={link.id} />
                    <input type="hidden" name="campaignId" value={link.campaign?.id ?? ""} />
                    <input type="hidden" name="postId" value={link.post?.id ?? ""} />
                  </ActionForm>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit ? (
        <ActionForm action={createLinkAction} submitLabel="Make tracking link" testId="link-form">
          <input type="hidden" name="campaignId" value={campaignId} />
          <input type="hidden" name="postId" value={postId} />
          <TextField label="Name (for your team)" name="label" maxLength={120} />
          <TextField
            label="Page of your shop"
            name="destination"
            maxLength={500}
            defaultValue="/"
            hint='A path like "/p/leather-tote" or the page’s full address. Links only lead to your own shop.'
          />
          <div className="grid gap-4 sm:grid-cols-3">
            <TextField
              label="Where it is shared"
              name="source"
              defaultValue={defaultSource}
              maxLength={60}
              hint="instagram, tiktok, whatsapp…"
            />
            <TextField
              label="Placement"
              name="medium"
              defaultValue="bio"
              maxLength={60}
              hint="bio, story, reel, post, message…"
            />
            <TextField
              label="Detail (optional)"
              name="content"
              maxLength={80}
              hint="To tell links apart, like reel-1."
            />
          </div>
        </ActionForm>
      ) : null}
    </div>
  );
}
