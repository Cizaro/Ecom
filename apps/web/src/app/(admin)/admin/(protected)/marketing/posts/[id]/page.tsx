import {
  getBusinessProfile,
  getPost,
  hasPermission,
  listLibrary,
  productsForPosts,
  safeTimeZone,
  zonedLocalInput,
} from "@ecom/core";
import { Alert, Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, TextField } from "../../../../_components/form";
import { deletePostAction, movePostAction, updatePostAction } from "../../actions";
import { CHANNEL_LABEL, FORMAT_LABEL, STATUS_LABEL, STATUS_TONE } from "../../labels";
import { PostFields } from "../post-fields";
import { CaptionDraft } from "./caption-draft";

export const metadata: Metadata = { title: "Post" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("content.write");
  const { id } = await params;
  const db = tenantDb(context);
  const post = await orNotFound(getPost(db, context, id));
  const [files, products, profile, store] = await Promise.all([
    listLibrary(db, context),
    productsForPosts(
      db,
      context,
      post.products.map((p) => p.id),
    ),
    getBusinessProfile(db),
    db.run((tx) =>
      tx.store.findFirst({ select: { timezone: true }, orderBy: { createdAt: "asc" } }),
    ),
  ]);
  const timeZone = safeTimeZone(store?.timezone);
  // Files already on the post stay pickable even when archived since.
  const pickable = [
    ...files,
    ...post.files
      .filter((f) => !files.some((g) => g.id === f.id))
      .map((f) => ({
        ...f,
        altText: "",
        tags: [],
        usageNote: "",
        mimeType: "",
        archived: true,
        createdAt: new Date(0),
        postCount: 1,
      })),
  ];
  const canApprove = hasPermission(context, "content.approve");
  const canPublish = hasPermission(context, "social.publish");
  const canDraft = hasPermission(context, "ai.use");
  const editable = post.status !== "published";
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone });
  const step = (name: string, label: string, tone: "primary" | "secondary" = "secondary") => (
    <ActionForm
      action={movePostAction}
      submitLabel={label}
      submitTone={tone}
      testId={`post-${name}`}
    >
      <input type="hidden" name="id" value={post.id} />
      <input type="hidden" name="step" value={name} />
    </ActionForm>
  );

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={post.title}
        description={
          <>
            {CHANNEL_LABEL[post.channel]} · {FORMAT_LABEL[post.format]}
            {post.plannedFor ? ` · planned for ${when.format(post.plannedFor)}` : ""}
            {" · "}
            <Link href="/admin/marketing/posts" className="underline underline-offset-4">
              Posts
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="post-status">
        <Badge tone={STATUS_TONE[post.status]}>{STATUS_LABEL[post.status]}</Badge>
        {post.approvedBy && (post.status === "approved" || post.status === "published") ? (
          <span className="text-ink-muted">Approved by {post.approvedBy}</span>
        ) : null}
        {post.publishedUrl ? (
          <a
            href={post.publishedUrl}
            className="underline underline-offset-4"
            target="_blank"
            rel="noopener noreferrer"
          >
            See the post
          </a>
        ) : null}
      </div>
      {post.reviewNote && post.status === "changes_requested" ? (
        <Alert tone="warning" testId="post-review-note">
          Changes requested: {post.reviewNote}
        </Alert>
      ) : null}

      <Card title="What happens next">
        <div className="flex flex-wrap items-start gap-3">
          {post.status === "draft" || post.status === "changes_requested"
            ? step("submit", "Send for approval", "primary")
            : null}
          {post.status === "in_review" ? step("unsubmit", "Take back to draft") : null}
          {post.status === "in_review" && canApprove ? step("approve", "Approve", "primary") : null}
          {post.status === "in_review" && canApprove ? (
            <ActionForm
              action={movePostAction}
              submitLabel="Ask for changes"
              submitTone="secondary"
              testId="post-request_changes"
            >
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="step" value="request_changes" />
              <TextField label="What should change?" name="note" maxLength={1000} />
            </ActionForm>
          ) : null}
          {post.status === "approved" && canPublish ? (
            <ActionForm
              action={movePostAction}
              submitLabel="Mark as published"
              submitTone="primary"
              testId="post-publish"
            >
              <input type="hidden" name="id" value={post.id} />
              <input type="hidden" name="step" value="publish" />
              <TextField
                label="Link to the live post"
                name="url"
                type="url"
                hint="Optional. Post it on the platform yourself, then record it here."
              />
            </ActionForm>
          ) : null}
          {post.status === "in_review" && !canApprove ? (
            <p className="text-sm text-ink-muted">Waiting for someone who can approve posts.</p>
          ) : null}
          {post.status === "approved" && !canPublish ? (
            <p className="text-sm text-ink-muted">
              Approved. Someone who can publish will post it.
            </p>
          ) : null}
          {post.status === "published" ? (
            <p className="text-sm text-ink-muted">Published. A published post cannot be changed.</p>
          ) : null}
        </div>
      </Card>

      {editable ? (
        <Card
          title="Post"
          description={
            post.status === "in_review" || post.status === "approved"
              ? "Saving a change sends the post back to draft: it must be approved again as changed."
              : undefined
          }
        >
          <ActionForm action={updatePostAction} submitLabel="Save" testId="post-form">
            <input type="hidden" name="id" value={post.id} />
            <PostFields
              files={pickable}
              products={products}
              value={{
                title: post.title,
                channel: post.channel,
                format: post.format,
                caption: post.caption,
                plannedFor: post.plannedFor ? zonedLocalInput(post.plannedFor, timeZone) : "",
                fileIds: post.files.map((f) => f.id),
                productIds: post.products.map((p) => p.id),
              }}
            />
          </ActionForm>
        </Card>
      ) : (
        <Card title="Caption">
          <p className="whitespace-pre-line text-sm" data-testid="post-caption">
            {post.caption}
          </p>
        </Card>
      )}

      {editable && canDraft ? (
        <Card
          title="Caption with AI"
          description="Drafted from the featured products' real details. No made-up prices, discounts or urgency."
        >
          <CaptionDraft postId={post.id} languages={profile.languages} />
        </Card>
      ) : null}

      {post.status !== "approved" && post.status !== "published" ? (
        <ActionForm
          action={deletePostAction}
          submitLabel="Delete post"
          submitTone="danger"
          testId="post-delete"
        >
          <input type="hidden" name="id" value={post.id} />
        </ActionForm>
      ) : null}
    </div>
  );
}
