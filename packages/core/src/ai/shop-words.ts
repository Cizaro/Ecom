// Common words shoppers in Lebanon use for what the shop sells, in Arabic,
// Lebanese Arabic and Arabic written in Latin letters ("Arabizi"), with the
// English words the catalog uses. The shop's fact lookup adds these English
// words to a question, so "عندكن شنطة سودا؟" or "3endkon shanta sawda?"
// finds black bags. It belongs to the shop's adapter, not to the AI module:
// another kind of business brings its own words (decision D88).
//
// A starting list: staff-written Arabic product names and the AI's own
// search words (search.terms) cover what is not here.

const WORDS: Record<string, readonly string[]> = {
  // Kinds of products
  bag: [
    "شنطة",
    "شنطه",
    "شنط",
    "حقيبة",
    "حقيبه",
    "حقائب",
    "جزدان",
    "shanta",
    "shante",
    "shantet",
    "shanat",
    "jezdan",
    "jizdan",
  ],
  tote: ["توت"],
  backpack: ["ضهر", "ظهر", "daher", "dahr"],
  wallet: [
    "محفظة",
    "محفظه",
    "محافظ",
    "مصرية",
    "ma7fazeh",
    "ma7faza",
    "mahfaza",
    "mahfazeh",
    "masriyye",
    "portefeuille",
  ],
  clutch: ["كلاتش", "clutch"],
  watch: ["ساعة", "ساعه", "ساعات", "sa3a", "se3a", "sa3at"],
  necklace: ["عقد", "سلسال", "سنسال", "طوق", "3e2d", "3a2d", "senseil", "selsel"],
  bracelet: ["اسوارة", "إسوارة", "اسواره", "سوار", "iswara", "eswara", "bracelet"],
  ring: ["خاتم", "محبس", "khatem", "khetem", "ma7bas"],
  earrings: ["حلق", "تراجي", "7ale2", "7ala2", "taraje"],
  jewelry: ["مجوهرات", "اكسسوار", "إكسسوار", "ذهب", "دهب", "mjawharat", "dahab", "accessoire"],
  belt: ["زنار", "حزام", "zennar", "zinnar", "7izem"],
  sunglasses: ["نضارات", "نظارات", "نضارة", "نظارة", "nadarat", "nadara", "nedarat"],
  leather: ["جلد", "جلدية", "jeld", "jild"],
  // Colours
  black: ["أسود", "اسود", "سودا", "سوداء", "aswad", "sawda", "sawde", "souda"],
  white: ["أبيض", "ابيض", "بيضا", "بيضاء", "abyad", "bayda", "baida"],
  brown: ["بني", "بنية", "bunni", "benne", "binne", "marron"],
  tan: ["جملي", "كاميل", "camel", "jamali"],
  beige: ["بيج", "beige", "bej"],
  red: ["أحمر", "احمر", "حمرا", "حمراء", "a7mar", "ahmar", "hamra", "7amra"],
  blue: ["أزرق", "ازرق", "زرقا", "زرقاء", "azra2", "azraq", "zar2a", "bleu"],
  navy: ["كحلي", "ka7le", "ka7li", "kohle"],
  green: ["أخضر", "اخضر", "خضرا", "خضراء", "akhdar", "khadra", "vert"],
  olive: ["زيتي", "zeite", "zayte"],
  pink: ["زهري", "وردي", "zahr", "zahre", "rose"],
  purple: ["بنفسجي", "موف", "mauve", "banafsaje"],
  burgundy: ["خمري", "نبيذي", "khamre", "bordeaux"],
  grey: ["رمادي", "رصاصي", "rmede", "ramadi", "gris"],
  gold: ["ذهبي", "دهبي", "dahabe", "dahabi", "doré"],
  silver: ["فضي", "fedde", "fiddi", "argent"],
  sand: ["رملي", "ramle"],
  orange: ["برتقالي", "laymoune", "orange"],
  yellow: ["أصفر", "اصفر", "صفرا", "asfar", "safra", "jaune"],
};

/** Arabic spelled one way: no "ال" prefix, one alef, ta marbuta and ha alike, no diacritics. */
export function normalizeArabic(word: string): string {
  return word
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/^(وال|بال|لل|ال)(?=.{2,})/, "");
}

const LOOKUP = new Map<string, string[]>();
for (const [english, words] of Object.entries(WORDS)) {
  for (const word of words) {
    const key = normalizeArabic(word.toLowerCase());
    LOOKUP.set(key, [...(LOOKUP.get(key) ?? []), english]);
  }
}

/** The catalog's English words for a shopper's words ("sawda" -> "black"). */
export function shopWordsFor(words: readonly string[]): string[] {
  const found = new Set<string>();
  for (const word of words) {
    for (const english of LOOKUP.get(normalizeArabic(word.toLowerCase())) ?? []) found.add(english);
  }
  return [...found];
}
