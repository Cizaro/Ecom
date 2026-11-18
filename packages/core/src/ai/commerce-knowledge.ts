import type { Fact, KnowledgeSource } from "@ecom/ai";
import { isLocale } from "@ecom/i18n";
import type { TenantDb } from "../access/tenant-db";
import { formatMoney } from "../catalog/money";
import { listPublicProducts } from "../catalog/public";
import { localizeProducts } from "../catalog/translations";
import { getCheckoutOptions } from "../shipping/shipping";
import { getPublishedPage, listPublishedPages, pageBlocks } from "../tenancy/store-pages";
import type { StoreBranding } from "../tenancy/branding";

// The shop's knowledge source for the AI (decision D88): the first adapter
// behind the AI module's interface. It reads only what shoppers can already
// see (published products, delivery areas, published policy pages, the
// store's contact details) and describes stock in words, never as counts.
// Another kind of business writes its own adapter; the AI does not change.

const MAX_PRODUCTS = 5;
const MAX_POLICY_PARTS = 4;

/** Words worth looking up: letters or digits, 3 or more, without common filler. */
const FILLER = new Set([
  "all",
  "also",
  "about",
  "tell",
  "off",
  "today",
  "just",
  "want",
  "need",
  "like",
  "know",
  "from",
  "they",
  "them",
  "our",
  "its",
  "thanks",
  "thank",
  "would",
  "could",
  "should",
  "will",
  "get",
  "the",
  "and",
  "for",
  "you",
  "your",
  "have",
  "has",
  "with",
  "what",
  "how",
  "when",
  "where",
  "can",
  "does",
  "is",
  "are",
  "this",
  "that",
  "there",
  "any",
  "much",
  "many",
  "please",
  "hello",
  "هل",
  "عندكم",
  "لديكم",
  "كم",
  "ما",
  "ماذا",
  "متى",
  "أين",
  "كيف",
  "من",
  "في",
  "على",
  "مرحبا",
]);

function keywords(question: string): string[] {
  // Every word of the question (the shop's search keeps only the first few).
  const words =
    question
      .slice(0, 1000)
      .toLowerCase()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  // Up to 16, in the order written: a long message (or one stuffed with
  // other words to push the real question out) still has its subject looked up.
  return [...new Set(words)].filter((word) => word.length >= 3 && !FILLER.has(word)).slice(0, 16);
}

const overlap = (text: string, words: readonly string[]) => {
  const lower = text.toLowerCase();
  return words.filter((word) => lower.includes(word)).length;
};

export function createCommerceKnowledge(
  db: TenantDb,
  store: { name: string; branding: StoreBranding },
): KnowledgeSource {
  return {
    abilities: () => [
      {
        id: "products",
        description: "Published products: name, price, sale price, colours, in stock or sold out",
      },
      { id: "delivery", description: "Delivery areas and their prices" },
      { id: "policies", description: "Published returns, delivery, privacy and terms pages" },
      { id: "contact", description: "The store's contact email and phone" },
    ],

    async search(question, { limit, language }) {
      const locale = isLocale(language) ? language : "en";
      const words = keywords(question);
      const facts: Fact[] = [];

      // Products matching any of the question's words, best matches first.
      const seen = new Set<string>();
      // Colours are not in product names: a word that is one of the store's
      // colours ("black") is looked up as a colour, before the other words.
      const storeColors = (await listPublicProducts(db, { pageSize: 1 })).facets.colors.map(
        (facet) => facet.value.toLowerCase(),
      );
      const colorWords = words.filter((word) => storeColors.includes(word));
      const queries = [
        ...colorWords.map((color) => ({ colors: [color] })),
        ...words.filter((word) => !colorWords.includes(word)).map((word) => ({ search: word })),
      ];
      for (const query of queries) {
        const list = await listPublicProducts(db, { ...query, pageSize: MAX_PRODUCTS });
        const items = await localizeProducts(db, locale, list.items, (item) => item.id);
        for (const item of items) {
          if (seen.has(item.id) || seen.size >= MAX_PRODUCTS) continue;
          seen.add(item.id);
          const price = formatMoney(item.priceAmount, item.currency);
          facts.push({
            id: `product:${item.slug}`,
            kind: "product",
            text: [
              `${item.name}${item.brandName ? ` by ${item.brandName}` : ""}`,
              `costs ${item.priceVaries ? "from " : ""}${price}`,
              item.regularPriceAmount !== null
                ? `(on sale; regular price ${formatMoney(item.regularPriceAmount, item.currency)})`
                : "",
              item.soldOut ? "and is sold out." : "and is available.",
              item.colors.length > 0 ? `Colours: ${item.colors.join(", ")}.` : "",
            ]
              .filter(Boolean)
              .join(" "),
          });
        }
      }

      // Delivery areas: few, and asked about often.
      const { zones } = await getCheckoutOptions(db);
      // Short, readable ids: models copy them back more reliably than long codes.
      const zoneIds = new Set<string>();
      const zoneId = (name: string, index: number) => {
        const slug = name
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "")
          .slice(0, 40);
        let id = `delivery:${slug || `area-${index + 1}`}`;
        if (zoneIds.has(id)) id = `${id}-${index + 1}`;
        zoneIds.add(id);
        return id;
      };
      for (const [index, zone] of zones.slice(0, 5).entries()) {
        const price = zone.rateAmount === 0 ? "free" : formatMoney(zone.rateAmount, zone.currency);
        const free =
          zone.freeOverAmount !== null
            ? `, free for orders over ${formatMoney(zone.freeOverAmount, zone.currency)}`
            : "";
        facts.push({
          id: zoneId(zone.name, index),
          kind: "delivery",
          text: `Delivery to ${zone.name} costs ${price}${free}.`,
        });
      }

      // Policy page parts sharing words with the question.
      if (words.length > 0) {
        const parts: { fact: Fact; score: number }[] = [];
        for (const { slug } of await listPublishedPages(db, locale)) {
          const page = await getPublishedPage(db, slug, locale);
          if (!page) continue;
          let heading = page.title;
          pageBlocks(page.body).forEach((block, index) => {
            if (block.type === "heading") {
              heading = block.text;
              return;
            }
            const text = `${page.title} - ${heading}: ${block.type === "list" ? block.items.join("; ") : block.text}`;
            const score = overlap(text, words) + overlap(slug, words);
            if (score > 0)
              parts.push({ fact: { id: `policy:${slug}#${index}`, kind: "policy", text }, score });
          });
        }
        parts.sort((a, b) => b.score - a.score);
        facts.push(...parts.slice(0, MAX_POLICY_PARTS).map((part) => part.fact));
      }

      const contact = [store.branding.contactEmail, store.branding.contactPhone].filter(Boolean);
      if (contact.length > 0) {
        facts.push({
          id: "store:contact",
          kind: "contact",
          text: `${store.name} can be reached at ${contact.join(" or ")}.`,
        });
      }
      return facts.slice(0, limit);
    },
  };
}
