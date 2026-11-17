import { getStoreSettings, listStorePages, pageTemplate, unfilledBlanks } from "@ecom/core";
import { LOCALE_INFO } from "@ecom/i18n";
import { Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm, CheckboxField, TextAreaField, TextField } from "../../../_components/form";
import { saveStorePageAction } from "../actions";

export const metadata: Metadata = { title: "Policy pages" };

export default async function PolicyPagesPage() {
  const { context } = await requirePermission("settings.write");
  const db = tenantDb(context);
  // One set of pages per language the shop is offered in.
  const { languages } = await getStoreSettings(db, context);
  const pages = await listStorePages(db, context, languages);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Policy pages"
        description="Your returns, delivery, privacy and terms pages. You write the rules; an empty page starts from a template with [BLANKS] to fill in, and a page cannot be published until every blank is filled. Published pages are linked at the bottom of your shop."
      />
      <p className="text-sm text-ink-muted">
        Write headings as <code>## Heading</code>, list items as <code>- item</code>, and leave an
        empty line between paragraphs. These templates are a starting point, not legal advice: check
        them against the rules where you sell.
      </p>
      {languages.length > 1 ? (
        <p className="text-sm text-ink-muted">
          Your shop is also offered in Arabic: write each page in Arabic too. Until an Arabic page
          is published, shoppers using Arabic see the English one.
        </p>
      ) : null}
      {pages.map((page) => {
        // The templates are in English; an Arabic page starts empty.
        const body =
          page.body || (page.locale === "en" ? pageTemplate(page.slug, context.tenantName) : "");
        const blanks = unfilledBlanks(body);
        const key = page.locale === "en" ? page.slug : `${page.slug}-${page.locale}`;
        return (
          <Card
            key={key}
            title={
              languages.length > 1
                ? `${page.title} (${LOCALE_INFO[page.locale].label})`
                : page.title
            }
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge tone={page.published ? "success" : "neutral"}>
                {page.published ? "Published" : page.body ? "Draft" : "Not started"}
              </Badge>
              {page.published ? (
                <Link href={`/policies/${page.slug}`} className="underline underline-offset-4">
                  See it in the shop
                </Link>
              ) : null}
              {blanks.length > 0 ? (
                <span className="text-ink-muted">{blanks.length} blanks to fill in</span>
              ) : null}
            </div>
            <ActionForm action={saveStorePageAction} submitLabel="Save" testId={`page-form-${key}`}>
              <input type="hidden" name="slug" value={page.slug} />
              <input type="hidden" name="locale" value={page.locale} />
              <TextField
                id={`title-${key}`}
                label="Title"
                name="title"
                maxLength={100}
                defaultValue={page.title}
              />
              <TextAreaField
                id={`body-${key}`}
                label="Text"
                dir={LOCALE_INFO[page.locale].dir}
                name="body"
                rows={14}
                maxLength={20000}
                defaultValue={body}
              />
              <CheckboxField
                id={`publish-${key}`}
                label="Published (shown in the shop)"
                name="publish"
                defaultChecked={page.published}
              />
            </ActionForm>
          </Card>
        );
      })}
    </div>
  );
}
