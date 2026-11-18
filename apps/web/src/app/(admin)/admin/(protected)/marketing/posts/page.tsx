import { listPosts, POST_STATUSES } from "@ecom/core";
import { Badge, buttonClasses, EmptyState, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { CHANNEL_LABEL, FORMAT_LABEL, STATUS_LABEL, STATUS_TONE } from "../labels";

export const metadata: Metadata = { title: "Content posts" };

type Params = Record<string, string | string[] | undefined>;

// Posts planned for social channels, by where they stand in the approval.
export default async function PostsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { context } = await requirePermission("content.write");
  const status = (await searchParams).status;
  const current = typeof status === "string" ? status : "";
  const { items, counts } = await listPosts(tenantDb(context), context, { status: current });
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Content posts"
        description={
          <>
            Plan posts, get them approved, and record when they go out.{" "}
            <Link href="/admin/marketing/calendar" className="underline underline-offset-4">
              Calendar
            </Link>
            {" · "}
            <Link href="/admin/marketing/library" className="underline underline-offset-4">
              Library
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href="/admin/marketing/posts/new" className={buttonClasses()}>
          New post
        </Link>
        <Link
          href="/admin/marketing/posts"
          className={buttonClasses(current ? "secondary" : "primary")}
          aria-current={current ? undefined : "page"}
        >
          All
        </Link>
        {POST_STATUSES.map((value) => (
          <Link
            key={value}
            href={`/admin/marketing/posts?status=${value}`}
            className={buttonClasses(current === value ? "primary" : "secondary")}
            aria-current={current === value ? "page" : undefined}
          >
            {STATUS_LABEL[value]} ({counts[value]})
          </Link>
        ))}
      </div>
      {items.length === 0 ? (
        <EmptyState title="No posts here yet" />
      ) : (
        <List testId="posts-list">
          {items.map((post) => (
            <ListItem key={post.id} testId="post-row">
              <div className="min-w-0">
                <Link
                  href={`/admin/marketing/posts/${post.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {post.title}
                </Link>
                <p className="text-sm text-ink-muted">
                  {CHANNEL_LABEL[post.channel]} · {FORMAT_LABEL[post.format]}
                  {post.plannedFor ? ` · ${when.format(post.plannedFor)}` : " · Not planned yet"}
                </p>
              </div>
              <Badge tone={STATUS_TONE[post.status]}>{STATUS_LABEL[post.status]}</Badge>
            </ListItem>
          ))}
        </List>
      )}
    </div>
  );
}
