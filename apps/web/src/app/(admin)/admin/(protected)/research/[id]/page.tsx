import { getCompetitor, productsForResearch, RESEARCH_KINDS } from "@ecom/core";
import { Badge, Card, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import {
  ActionForm,
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from "../../../_components/form";
import { addObservationAction, saveCompetitorAction } from "../actions";
import { CompetitorFields } from "../competitor-fields";
import { KIND_LABEL } from "../labels";
import { ObservationList } from "../observation-list";

export const metadata: Metadata = { title: "Competitor" };

export default async function CompetitorPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("research.write");
  const { id } = await params;
  const db = tenantDb(context);
  const competitor = await orNotFound(getCompetitor(db, context, id));
  const [products, store] = await Promise.all([
    productsForResearch(db, context),
    db.run((tx) =>
      tx.store.findFirst({ select: { defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
    ),
  ]);
  const links = [
    competitor.website ? { label: "Website", href: competitor.website } : null,
    competitor.facebook ? { label: "Facebook", href: competitor.facebook } : null,
    competitor.instagram
      ? {
          label: `Instagram @${competitor.instagram}`,
          href: `https://www.instagram.com/${competitor.instagram}/`,
        }
      : null,
    competitor.tiktok
      ? {
          label: `TikTok @${competitor.tiktok}`,
          href: `https://www.tiktok.com/@${competitor.tiktok}`,
        }
      : null,
  ].filter((link): link is { label: string; href: string } => link !== null);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={competitor.name}
        description={
          <Link href="/admin/research" className="underline underline-offset-4">
            All competitors
          </Link>
        }
      />
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {competitor.archived ? <Badge tone="warning">Archived</Badge> : null}
        {links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="underline underline-offset-4"
          >
            {link.label}
          </a>
        ))}
      </div>

      <Card
        title="Add what you saw"
        description="Look at their public pages yourself and note what matters, with the link and the date."
      >
        <ActionForm
          action={addObservationAction}
          submitLabel="Add observation"
          testId="observation-form"
        >
          <input type="hidden" name="competitorId" value={competitor.id} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectField
              label="What"
              name="kind"
              defaultValue="product"
              options={RESEARCH_KINDS.map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))}
            />
            <TextField
              label="Seen on"
              name="observedOn"
              type="date"
              defaultValue={new Date().toISOString().slice(0, 10)}
            />
          </div>
          <TextField label="In a few words" name="title" maxLength={200} />
          <TextAreaField label="Details" name="detail" rows={2} maxLength={2000} />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label={`Price seen (${store?.defaultCurrency ?? "USD"})`}
              name="price"
              inputMode="decimal"
              hint="Optional."
            />
            <SelectField
              label="Similar product of ours"
              name="productId"
              defaultValue=""
              hint="To compare prices."
              options={[
                { value: "", label: "None" },
                ...products.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
          <TextField label="Link to where you saw it" name="sourceUrl" hint="Optional." />
        </ActionForm>
      </Card>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Observations</h2>
        {competitor.observations.length === 0 ? (
          <EmptyState title="Nothing noted yet" />
        ) : (
          <ObservationList observations={competitor.observations} canDelete />
        )}
      </section>

      <Card title="About them">
        <ActionForm action={saveCompetitorAction} submitLabel="Save" testId="competitor-form">
          <input type="hidden" name="id" value={competitor.id} />
          <CompetitorFields
            value={{
              name: competitor.name,
              website: competitor.website ?? "",
              instagram: competitor.instagram ? `@${competitor.instagram}` : "",
              facebook: competitor.facebook ?? "",
              tiktok: competitor.tiktok ? `@${competitor.tiktok}` : "",
              tags: competitor.tags.join(", "),
              notes: competitor.notes,
            }}
          />
          <CheckboxField
            label="Archived (no longer watched)"
            name="archived"
            defaultChecked={competitor.archived}
          />
        </ActionForm>
      </Card>
    </div>
  );
}
