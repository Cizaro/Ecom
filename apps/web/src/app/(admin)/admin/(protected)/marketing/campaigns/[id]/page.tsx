import { campaignChoices, formatMoney, getCampaign, listLinks, moneyToInput } from "@ecom/core";
import { Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { shopOrigin } from "@/server/shop-url";
import { ActionForm } from "../../../../_components/form";
import { TrackingLinks } from "../../_components/tracking-links";
import {
  CAMPAIGN_STATUS_LABEL,
  CAMPAIGN_STATUS_TONE,
  OBJECTIVE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
} from "../../labels";
import { deleteCampaignAction, updateCampaignAction } from "../actions";
import { CampaignFields } from "../campaign-fields";

export const metadata: Metadata = { title: "Campaign" };

const when = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("marketing.write");
  const { id } = await params;
  const db = tenantDb(context);
  const campaign = await orNotFound(getCampaign(db, context, id));
  const [choices, links, origin] = await Promise.all([
    campaignChoices(db, context),
    listLinks(db, context, { campaignId: id }),
    shopOrigin(db),
  ]);
  // Products already on the campaign stay pickable even if not among the newest.
  const products = [
    ...campaign.products,
    ...choices.products.filter((p) => !campaign.products.some((q) => q.id === p.id)),
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={campaign.name}
        description={
          <>
            {OBJECTIVE_LABEL[campaign.objective]} · {campaign.startsOn}
            {campaign.endsOn ? ` to ${campaign.endsOn}` : ""}
            {" · "}
            <Link href="/admin/marketing/campaigns" className="underline underline-offset-4">
              Plan
            </Link>
          </>
        }
      />
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={CAMPAIGN_STATUS_TONE[campaign.status]}>
          {CAMPAIGN_STATUS_LABEL[campaign.status]}
        </Badge>
      </div>

      <Card
        title="Results so far"
        description="Counted from your shop only. Views and reach on Instagram, Facebook and TikTok come when the accounts are connected."
      >
        <dl className="grid gap-4 text-sm sm:grid-cols-3" data-testid="campaign-results">
          <div>
            <dt className="text-ink-muted">Clicks on its tracking links</dt>
            <dd className="text-2xl font-semibold">{campaign.clicks}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">
              {campaign.discountCode
                ? `Orders with code ${campaign.discountCode.code} while it ran`
                : "Orders with its code"}
            </dt>
            <dd className="text-2xl font-semibold">
              {campaign.codeOrders ? campaign.codeOrders.count : "No code linked"}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Their value, after refunds</dt>
            <dd className="text-2xl font-semibold">
              {campaign.codeOrders
                ? formatMoney(campaign.codeOrders.revenueAmount, campaign.currency)
                : "—"}
            </dd>
          </div>
        </dl>
      </Card>

      <Card title="Posts">
        {campaign.posts.length === 0 ? (
          <p className="text-sm text-ink-muted">
            No posts yet. Choose this campaign on a post to see it here.{" "}
            <Link href="/admin/marketing/posts/new" className="underline underline-offset-4">
              New post
            </Link>
          </p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm" data-testid="campaign-posts">
            {campaign.posts.map((post) => (
              <li key={post.id} className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/admin/marketing/posts/${post.id}`}
                  className="underline underline-offset-4"
                >
                  {post.title}
                </Link>
                <Badge tone={STATUS_TONE[post.status as keyof typeof STATUS_TONE]}>
                  {STATUS_LABEL[post.status as keyof typeof STATUS_LABEL]}
                </Badge>
                {post.plannedFor ? (
                  <span className="text-ink-muted">{when.format(post.plannedFor)}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card
        title="Tracking links"
        description="Share the short link in your bio, stories or messages: each click is counted (no visitor data is kept)."
      >
        <TrackingLinks links={links} origin={origin} canEdit campaignId={campaign.id} />
      </Card>

      <Card title="Brief">
        <ActionForm action={updateCampaignAction} submitLabel="Save" testId="campaign-form">
          <input type="hidden" name="id" value={campaign.id} />
          <CampaignFields
            choices={{ ...choices, products }}
            currency={campaign.currency}
            value={{
              name: campaign.name,
              objective: campaign.objective,
              status: campaign.status,
              startsOn: campaign.startsOn,
              endsOn: campaign.endsOn ?? "",
              channels: campaign.channels,
              audience: campaign.audience,
              keyMessage: campaign.keyMessage,
              offer: campaign.offer,
              budget:
                campaign.budgetAmount !== null
                  ? moneyToInput(campaign.budgetAmount, campaign.currency)
                  : "",
              discountCodeId: campaign.discountCode?.id ?? "",
              segmentId: campaign.segment?.id ?? "",
              notes: campaign.notes,
              productIds: campaign.products.map((p) => p.id),
            }}
          />
        </ActionForm>
      </Card>

      <ActionForm
        action={deleteCampaignAction}
        submitLabel="Delete campaign"
        submitTone="danger"
        testId="campaign-delete"
      >
        <input type="hidden" name="id" value={campaign.id} />
        <p className="text-xs text-ink-muted">Its posts and links stay, no longer linked to it.</p>
      </ActionForm>
    </div>
  );
}
