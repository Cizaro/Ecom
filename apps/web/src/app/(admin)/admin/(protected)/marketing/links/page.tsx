import { listLinks } from "@ecom/core";
import { Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { shopOrigin } from "@/server/shop-url";
import { TrackingLinks } from "../_components/tracking-links";

export const metadata: Metadata = { title: "Tracking links" };

// Every tracking link, most clicked first: which bio link, story or reel
// brings people to the shop.
export default async function LinksPage() {
  const { context } = await requirePermission("marketing.write");
  const db = tenantDb(context);
  const [links, origin] = await Promise.all([listLinks(db, context), shopOrigin(db)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tracking links"
        description={
          <>
            Short links to pages of your shop, each counting its clicks. Make one on a post or a
            campaign to tie it to them.{" "}
            <Link href="/admin/marketing/campaigns" className="underline underline-offset-4">
              Marketing plan
            </Link>
          </>
        }
      />
      <Card>
        <TrackingLinks links={links} origin={origin} canEdit showOwner />
      </Card>
    </div>
  );
}
