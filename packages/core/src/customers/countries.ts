// Countries and what an address needs in each. Plain data and logic, shared
// by saved addresses now and by checkout and shipping later.

/** ISO 3166-1 alpha-2 codes of the countries and territories an address may be in. */
export const COUNTRY_CODES = (
  "AD AE AF AG AI AL AM AO AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS " +
  "BT BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE " +
  "EG ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GT GU GW GY HK HN HR " +
  "HT HU ID IE IL IM IN IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK " +
  "LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC " +
  "NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PR PS PT PW PY QA RE RO RS RU RW SA " +
  "SB SC SD SE SG SH SI SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TG TH TJ TK TL TM TN TO TR TT " +
  "TV TW TZ UA UG US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW"
).split(" ");

const KNOWN = new Set(COUNTRY_CODES);

export function isCountryCode(value: unknown): value is string {
  return typeof value === "string" && KNOWN.has(value);
}

/** The country's name in the given language, falling back to the code. */
export function countryName(code: string, locale = "en"): string {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Countries sorted by name, for a drop-down. */
export function countryOptions(locale = "en"): { value: string; label: string }[] {
  return COUNTRY_CODES.map((code) => ({ value: code, label: countryName(code, locale) })).sort(
    (a, b) => a.label.localeCompare(b.label, locale),
  );
}

type Need = "required" | "optional" | "unused";

export interface AddressRules {
  postalCode: Need;
  /** What a valid postal code looks like, when the country has a fixed form. */
  postalPattern?: RegExp;
  postalExample?: string;
  postalLabel: string;
  region: Need;
  regionLabel: string;
}

const DEFAULT_RULES: AddressRules = {
  postalCode: "optional",
  postalLabel: "Postal code",
  region: "optional",
  regionLabel: "State or region",
};

const rules = (partial: Partial<AddressRules>): AddressRules => ({ ...DEFAULT_RULES, ...partial });

/**
 * Countries whose addresses have firm rules. Everywhere else, a postal code
 * and a region are accepted but not demanded: wrongly refusing a real address
 * is worse than accepting an unusual one.
 */
const COUNTRY_RULES: Record<string, AddressRules> = {
  US: rules({
    postalCode: "required",
    postalPattern: /^\d{5}(-\d{4})?$/,
    postalExample: "94103",
    postalLabel: "ZIP code",
    region: "required",
    regionLabel: "State",
  }),
  CA: rules({
    postalCode: "required",
    postalPattern: /^[A-Z]\d[A-Z] ?\d[A-Z]\d$/,
    postalExample: "K1A 0B1",
    region: "required",
    regionLabel: "Province",
  }),
  GB: rules({
    postalCode: "required",
    postalPattern: /^[A-Z]{1,2}\d[A-Z\d]? ?\d[A-Z]{2}$/,
    postalExample: "SW1A 1AA",
    postalLabel: "Postcode",
    regionLabel: "County",
  }),
  AU: rules({
    postalCode: "required",
    postalPattern: /^\d{4}$/,
    postalExample: "2000",
    postalLabel: "Postcode",
    region: "required",
    regionLabel: "State or territory",
  }),
  DE: rules({ postalCode: "required", postalPattern: /^\d{5}$/, postalExample: "10115" }),
  FR: rules({ postalCode: "required", postalPattern: /^\d{5}$/, postalExample: "75001" }),
  IT: rules({ postalCode: "required", postalPattern: /^\d{5}$/, postalExample: "00100" }),
  ES: rules({ postalCode: "required", postalPattern: /^\d{5}$/, postalExample: "28001" }),
  NL: rules({
    postalCode: "required",
    postalPattern: /^\d{4} ?[A-Z]{2}$/,
    postalExample: "1012 AB",
  }),
  TR: rules({ postalCode: "required", postalPattern: /^\d{5}$/, postalExample: "34000" }),
  IN: rules({
    postalCode: "required",
    postalPattern: /^\d{6}$/,
    postalExample: "110001",
    postalLabel: "PIN code",
    region: "required",
    regionLabel: "State",
  }),
  SA: rules({
    postalPattern: /^\d{5}(-\d{4})?$/,
    postalExample: "11564",
    regionLabel: "Region",
  }),
  EG: rules({ postalPattern: /^\d{5}$/, postalExample: "11511", regionLabel: "Governorate" }),
  JO: rules({ postalPattern: /^\d{5}$/, postalExample: "11118", regionLabel: "Governorate" }),
  KW: rules({ postalPattern: /^\d{5}$/, postalExample: "13001", regionLabel: "Governorate" }),
  // No postal codes in use.
  AE: rules({ postalCode: "unused", region: "required", regionLabel: "Emirate" }),
  QA: rules({ postalCode: "unused", regionLabel: "Municipality" }),
  BH: rules({ postalPattern: /^\d{3,4}$/, postalExample: "317", regionLabel: "Governorate" }),
  OM: rules({ postalPattern: /^\d{3}$/, postalExample: "100", regionLabel: "Governorate" }),
  HK: rules({ postalCode: "unused", regionLabel: "District" }),
  IE: rules({ postalLabel: "Eircode", regionLabel: "County" }),
};

export function addressRules(country: string): AddressRules {
  return COUNTRY_RULES[country] ?? DEFAULT_RULES;
}
