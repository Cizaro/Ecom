import { listLibrary, productsForPosts } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm } from "../../../../_components/form";
import { createPostAction } from "../../actions";
import { PostFields } from "../post-fields";

export const metadata: Metadata = { title: "New post" };

export default async function NewPostPage() {
  const { context } = await requirePermission("content.write");
  const db = tenantDb(context);
  const [files, products] = await Promise.all([
    listLibrary(db, context),
    productsForPosts(db, context),
  ]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="New post"
        description={
          <Link href="/admin/marketing/posts" className="underline underline-offset-4">
            Back to posts
          </Link>
        }
      />
      <Card>
        <ActionForm action={createPostAction} submitLabel="Save draft" testId="post-form">
          <PostFields files={files} products={products} />
        </ActionForm>
      </Card>
    </div>
  );
}
