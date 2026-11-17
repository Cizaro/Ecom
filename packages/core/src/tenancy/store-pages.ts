import { assertPermission, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { DEFAULT_LOCALE, isLocale, type Locale } from "@ecom/i18n";

// A store's policy pages: returns, delivery, privacy and terms. Staff write
// them; the platform never invents a store's rules. Templates help staff
// start, with every store-specific fact left as a [BLANK IN CAPITALS], and a
// page with a blank left cannot be published. Text is stored plain and shown
// as headings, paragraphs and lists (no HTML is ever taken from it).

export const PAGE_SLUGS = ["returns", "delivery", "privacy", "terms"] as const;
export type PageSlug = (typeof PAGE_SLUGS)[number];

export const DEFAULT_PAGE_TITLES: Record<PageSlug, string> = {
  returns: "Returns and refunds",
  delivery: "Delivery",
  privacy: "Privacy",
  terms: "Terms of sale",
};

/** Starting titles for pages in Arabic. */
export const DEFAULT_PAGE_TITLES_AR: Record<PageSlug, string> = {
  returns: "الإرجاع والاسترداد",
  delivery: "التوصيل",
  privacy: "الخصوصية",
  terms: "شروط البيع",
};

const defaultTitle = (slug: PageSlug, locale: Locale) =>
  locale === "ar" ? DEFAULT_PAGE_TITLES_AR[slug] : DEFAULT_PAGE_TITLES[slug];

export class StorePageError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "StorePageError";
  }
}

/**
 * Starting points for each page. They describe what this platform actually
 * does (for example, only essential cookies) and leave every decision that is
 * the store's own as a blank.
 */
export function pageTemplate(slug: PageSlug, storeName: string): string {
  switch (slug) {
    case "returns":
      return [
        `You can return items bought from ${storeName} within [NUMBER OF DAYS] days of receiving them.`,
        "",
        "## What can be returned",
        "- Items in their original condition, unused, with their tags and packaging.",
        "- [ITEMS THAT CANNOT BE RETURNED, FOR EXAMPLE EARRINGS FOR HYGIENE REASONS]",
        "",
        "## How to return an item",
        `Write to us from the Contact us page with your order number. We will tell you how to send it back. [WHO PAYS FOR RETURN DELIVERY]`,
        "",
        "## Refunds",
        "Once we receive and check the item, we refund [HOW: CASH, BANK TRANSFER OR TO THE ORIGINAL PAYMENT METHOD] within [NUMBER OF DAYS] days.",
        "",
        "## Damaged or wrong items",
        "If an item arrives damaged or is not what you ordered, contact us within [NUMBER OF DAYS] days and we will put it right at no cost to you.",
      ].join("\n");
    case "delivery":
      return [
        `${storeName} delivers to [WHERE YOU DELIVER].`,
        "",
        "## Delivery prices",
        "The delivery price for your area is shown at checkout before you place your order. [FREE DELIVERY CONDITIONS, IF ANY]",
        "",
        "## Delivery times",
        "Orders usually arrive within [USUAL DELIVERY TIME]. We will tell you if an order is delayed.",
        "",
        "## Paying on delivery",
        "With cash on delivery, please have the exact amount shown in your order ready for the courier.",
        "",
        "## If you are not at home",
        "[WHAT HAPPENS IF THE COURIER CANNOT REACH THE CUSTOMER]",
      ].join("\n");
    case "privacy":
      return [
        `This page explains what ${storeName} does with your personal information.`,
        "",
        "## What we collect",
        "- Your name, email address, phone number and delivery address, when you order or create an account.",
        "- Your orders, messages to us, reviews and any photos you choose to share.",
        "",
        "## Why we use it",
        "- To deliver your orders and contact you about them.",
        "- To answer your messages.",
        "- To send you news and offers, only if you ask us to (you can stop at any time from your account).",
        "",
        "## Cookies",
        "We use only the cookies the shop needs to work: your cart and your sign-in. We do not use advertising or tracking cookies.",
        "",
        "## Who we share it with",
        "- The courier who delivers your order.",
        "- The services that send our emails and store our files, only to provide those services.",
        "- [ANY OTHER SERVICE, OR WRITE: NOBODY ELSE]",
        "We never sell your information.",
        "",
        "## How long we keep it",
        "We keep order records for [HOW LONG] for accounting. You can ask us to delete your account at any time.",
        "",
        "## Your rights",
        "You can ask to see, correct or delete your information by writing to [CONTACT EMAIL].",
      ].join("\n");
    case "terms":
      return [
        `These terms apply when you buy from ${storeName}, run by [BUSINESS NAME AND ADDRESS].`,
        "",
        "## Prices and payment",
        "Prices are in [CURRENCY] and [INCLUDE OR DO NOT INCLUDE] VAT. The total, with delivery, is shown before you place your order. You can pay [PAYMENT METHODS].",
        "",
        "## Your order",
        "Your order is confirmed when you receive our confirmation email. If an item becomes unavailable, we will tell you and refund anything you paid for it.",
        "",
        "## Delivery and returns",
        "See our Delivery and Returns pages.",
        "",
        "## Contact",
        "Questions? Use the Contact us page or write to [CONTACT EMAIL].",
      ].join("\n");
  }
}

/** Blanks left in a page, like "[NUMBER OF DAYS]". */
export function unfilledBlanks(body: string): string[] {
  return [...new Set(body.match(/\[[A-Z][A-Z0-9 ,.:'’/()-]*\]/g) ?? [])];
}

export type PageBlock =
  | { type: "heading"; text: string }
  | { type: "paragraph"; text: string }
  | { type: "list"; items: string[] };

/** Plain text into blocks: "## " starts a heading, "- " a list item, an empty line a new paragraph. */
export function pageBlocks(body: string): PageBlock[] {
  const blocks: PageBlock[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  for (const raw of body.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (!line) {
      flush();
    } else if (line.startsWith("## ")) {
      flush();
      blocks.push({ type: "heading", text: line.slice(3).trim() });
    } else if (line.startsWith("- ")) {
      flush();
      const last = blocks[blocks.length - 1];
      if (last?.type === "list") last.items.push(line.slice(2).trim());
      else blocks.push({ type: "list", items: [line.slice(2).trim()] });
    } else {
      paragraph.push(line);
    }
  }
  flush();
  return blocks;
}

export interface StorePageView {
  slug: PageSlug;
  locale: Locale;
  title: string;
  body: string;
  published: boolean;
  publishedAt: Date | null;
  updatedAt: Date | null;
}

/**
 * All four pages for staff, in each of the given languages, with empty ones
 * where nothing is written yet.
 */
export async function listStorePages(
  db: TenantDb,
  context: RequestContext,
  locales: readonly Locale[] = [DEFAULT_LOCALE],
): Promise<StorePageView[]> {
  assertPermission(context, "settings.write");
  const rows = await db.run((tx) =>
    tx.storePage.findMany({
      select: {
        slug: true,
        locale: true,
        title: true,
        body: true,
        published: true,
        publishedAt: true,
        updatedAt: true,
      },
    }),
  );
  return locales.flatMap((locale) =>
    PAGE_SLUGS.map((slug): StorePageView => {
      const row = rows.find((r) => r.slug === slug && r.locale === locale);
      return row
        ? { ...row, slug, locale }
        : {
            slug,
            locale,
            title: defaultTitle(slug, locale),
            body: "",
            published: false,
            publishedAt: null,
            updatedAt: null,
          };
    }),
  );
}

export async function saveStorePage(
  db: TenantDb,
  context: RequestContext,
  slugInput: unknown,
  input: { title: unknown; body: unknown; publish: unknown; locale?: unknown },
): Promise<void> {
  assertPermission(context, "settings.write");
  const slug = PAGE_SLUGS.find((value) => value === slugInput);
  if (!slug) throw new StorePageError("Unknown page.");
  const locale = input.locale === undefined ? DEFAULT_LOCALE : input.locale;
  if (!isLocale(locale)) throw new StorePageError("Unknown language.");
  const title = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
  if (!title) throw new StorePageError("Enter the page title.", "title");
  if (title.length > 100)
    throw new StorePageError("Shorten the title (100 characters at most).", "title");
  const body = typeof input.body === "string" ? input.body.replace(/\r\n?/g, "\n").trim() : "";
  if (body.length > 20_000)
    throw new StorePageError("Shorten the page (20,000 characters at most).", "body");
  const publish = input.publish === true || input.publish === "on";
  if (publish) {
    if (body.length < 50) {
      throw new StorePageError(
        "Write the page before publishing it (50 characters at least).",
        "body",
      );
    }
    const blanks = unfilledBlanks(body);
    if (blanks.length > 0) {
      throw new StorePageError(
        `Fill in the blanks before publishing: ${blanks.slice(0, 5).join(", ")}${blanks.length > 5 ? "…" : ""}`,
        "body",
      );
    }
  }
  await db.run(async (tx) => {
    const before = await tx.storePage.findUnique({
      where: { tenantId_slug_locale: { tenantId: db.tenantId, slug, locale } },
      select: { published: true, publishedAt: true },
    });
    const publishedAt = publish ? (before?.published ? before.publishedAt : new Date()) : null;
    await tx.storePage.upsert({
      where: { tenantId_slug_locale: { tenantId: db.tenantId, slug, locale } },
      create: {
        tenantId: db.tenantId,
        slug,
        locale,
        title,
        body,
        published: publish,
        publishedAt,
        updatedByUserId: context.userId,
      },
      update: { title, body, published: publish, publishedAt, updatedByUserId: context.userId },
    });
    await audit(tx, context, "settings.page_saved", { type: "store_page", id: null }, undefined, {
      slug,
      locale,
      published: publish,
    });
  });
}

/**
 * A published page for shoppers, in their language when the store has
 * published it in that language, otherwise in the default one; null when it
 * is not published at all.
 */
export async function getPublishedPage(
  db: TenantDb,
  slugInput: string,
  locale: Locale = DEFAULT_LOCALE,
): Promise<{
  slug: PageSlug;
  title: string;
  body: string;
  publishedAt: Date | null;
  updatedAt: Date;
  /** The language the page is shown in. */
  locale: Locale;
} | null> {
  const slug = PAGE_SLUGS.find((value) => value === slugInput);
  if (!slug) return null;
  const rows = await db.run((tx) =>
    tx.storePage.findMany({
      where: { slug, published: true },
      select: { locale: true, title: true, body: true, publishedAt: true, updatedAt: true },
    }),
  );
  const row = pickLanguage(rows, locale);
  if (!row) return null;
  const { locale: shownIn, ...page } = row;
  return { slug, locale: isLocale(shownIn) ? shownIn : DEFAULT_LOCALE, ...page };
}

/** The row in the shopper's language, else the one in the default language, else any. */
function pickLanguage<T extends { locale: string }>(rows: T[], locale: Locale): T | undefined {
  return (
    rows.find((r) => r.locale === locale) ??
    rows.find((r) => r.locale === DEFAULT_LOCALE) ??
    rows[0]
  );
}

/** The published pages' titles, for the shop's footer, in the shopper's language where written. */
export async function listPublishedPages(
  db: TenantDb,
  locale: Locale = DEFAULT_LOCALE,
): Promise<{ slug: PageSlug; title: string }[]> {
  const rows = await db.run((tx) =>
    tx.storePage.findMany({
      where: { published: true },
      select: { slug: true, locale: true, title: true },
    }),
  );
  return PAGE_SLUGS.flatMap((slug) => {
    const row = pickLanguage(
      rows.filter((r) => r.slug === slug),
      locale,
    );
    return row ? [{ slug, title: row.title }] : [];
  });
}
