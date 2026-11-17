import { getPublishedPage, pageBlocks } from "@ecom/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { LOCALE_INFO } from "@ecom/i18n";
import { shopT } from "@/server/i18n";
import { storefrontDb } from "@/server/storefront";
import { Breadcrumbs } from "../../_components/breadcrumbs";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const [{ db }, t] = await Promise.all([storefrontDb(), shopT()]);
  const { slug } = await params;
  const page = await getPublishedPage(db, slug, t.locale);
  return page ? { title: page.title, alternates: { canonical: `/policies/${page.slug}` } } : {};
}

// A store's policy page, written by its staff. Shown as plain headings,
// paragraphs and lists: no HTML is taken from the text.
export default async function PolicyPage({ params }: Props) {
  const [{ db }, t] = await Promise.all([storefrontDb(), shopT()]);
  const { slug } = await params;
  const page = await getPublishedPage(db, slug, t.locale);
  if (!page) notFound();
  const updated = new Intl.DateTimeFormat(t.intl, { dateStyle: "long" }).format(page.updatedAt);

  return (
    <article
      // Shown in English when the store has not written this page in the shopper's language.
      lang={page.locale}
      dir={LOCALE_INFO[page.locale].dir}
      className="mx-auto flex w-full max-w-2xl flex-col gap-4"
      data-testid="policy-page"
    >
      <Breadcrumbs trail={[{ name: t("Home"), href: "/" }]} current={page.title} />
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{page.title}</h1>
      <p className="text-sm text-ink-muted">{t("Last updated {date}", { date: updated })}</p>
      {pageBlocks(page.body).map((block, index) =>
        block.type === "heading" ? (
          <h2 key={index} className="pt-2 text-lg font-semibold">
            {block.text}
          </h2>
        ) : block.type === "list" ? (
          <ul key={index} className="list-disc ps-6 text-ink-muted">
            {block.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        ) : (
          <p key={index} className="text-ink-muted">
            {block.text}
          </p>
        ),
      )}
    </article>
  );
}
