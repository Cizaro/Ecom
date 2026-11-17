import type { AppTransaction } from "@ecom/db";
import type { TenantDb } from "../access/tenant-db";
import { cleanPhone, CustomerError } from "./accounts";
import { addressRules, countryName, isCountryCode } from "./countries";

// A customer's saved addresses. Every function takes the customer's ID from
// their session (never from a form) and looks addresses up inside that
// customer only, so an address ID from someone else is simply "not found".

export const MAX_ADDRESSES = 10;

export interface AddressInput {
  fullName: unknown;
  phone?: unknown;
  line1: unknown;
  line2?: unknown;
  city: unknown;
  region?: unknown;
  postalCode?: unknown;
  country: unknown;
}

export interface ValidAddress {
  fullName: string;
  phone: string | null;
  line1: string;
  line2: string | null;
  city: string;
  region: string | null;
  postalCode: string | null;
  country: string;
}

export interface SavedAddress extends ValidAddress {
  id: string;
  isDefaultShipping: boolean;
  isDefaultBilling: boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Collapses runs of spaces and removes control characters a form should never carry. */
const tidy = (value: unknown): string =>
  typeof value === "string"
    ? value
        // eslint-disable-next-line no-control-regex -- removing control characters is the point
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
    : "";

function required(value: unknown, field: string, label: string, max: number): string {
  const text = tidy(value);
  if (text === "") throw new CustomerError("invalid", `Enter ${label}.`, field);
  if (text.length > max) {
    throw new CustomerError("invalid", `Shorten ${label} (${max} characters at most).`, field);
  }
  return text;
}

function optional(value: unknown, field: string, label: string, max: number): string | null {
  const text = tidy(value);
  if (text.length > max) {
    throw new CustomerError("invalid", `Shorten ${label} (${max} characters at most).`, field);
  }
  return text === "" ? null : text;
}

/**
 * Checks an address against its country's rules and returns it tidied. The
 * same check is used for saved addresses and, later, for checkout.
 */
export function validateAddress(input: AddressInput): ValidAddress {
  const country = tidy(input.country).toUpperCase();
  if (!isCountryCode(country)) {
    throw new CustomerError("invalid", "Choose a country from the list.", "country");
  }
  const rules = addressRules(country);
  const name = countryName(country);

  let postalCode = optional(input.postalCode, "postalCode", "the postal code", 16);
  if (rules.postalCode === "unused") {
    postalCode = null;
  } else {
    postalCode = postalCode?.toUpperCase() ?? null;
    if (!postalCode && rules.postalCode === "required") {
      throw new CustomerError(
        "invalid",
        `Enter the ${rules.postalLabel.toLowerCase()}.`,
        "postalCode",
      );
    }
    if (postalCode && rules.postalPattern && !rules.postalPattern.test(postalCode)) {
      throw new CustomerError(
        "invalid",
        `That is not a ${rules.postalLabel.toLowerCase()} used in ${name}. ` +
          `It should look like ${rules.postalExample}.`,
        "postalCode",
      );
    }
  }

  let region = optional(input.region, "region", "the region", 100);
  if (rules.region === "unused") region = null;
  if (!region && rules.region === "required") {
    throw new CustomerError("invalid", `Enter the ${rules.regionLabel.toLowerCase()}.`, "region");
  }

  return {
    fullName: required(input.fullName, "fullName", "the full name", 200),
    phone: cleanPhone(input.phone),
    line1: required(input.line1, "line1", "the address", 200),
    line2: optional(input.line2, "line2", "the second address line", 200),
    city: required(input.city, "city", "the city", 100),
    region,
    postalCode,
    country,
  };
}

const SELECT = {
  id: true,
  fullName: true,
  phone: true,
  line1: true,
  line2: true,
  city: true,
  region: true,
  postalCode: true,
  country: true,
  isDefaultShipping: true,
  isDefaultBilling: true,
} as const;

const notFound = () => new CustomerError("not_found", "That address could not be found.");

async function findOwn(tx: AppTransaction, customerId: string, addressId: string) {
  if (typeof addressId !== "string" || !UUID.test(addressId)) throw notFound();
  const address = await tx.address.findFirst({
    where: { id: addressId, customerId },
    select: SELECT,
  });
  if (!address) throw notFound();
  return address;
}

/** Default addresses first, then the newest. */
export async function listAddresses(db: TenantDb, customerId: string): Promise<SavedAddress[]> {
  return db.run((tx) =>
    tx.address.findMany({
      where: { customerId },
      select: SELECT,
      orderBy: [{ isDefaultShipping: "desc" }, { isDefaultBilling: "desc" }, { createdAt: "desc" }],
    }),
  );
}

export async function getAddress(
  db: TenantDb,
  customerId: string,
  addressId: string,
): Promise<SavedAddress> {
  return db.run((tx) => findOwn(tx, customerId, addressId));
}

/** Saves an address. A customer's first address becomes their default for both uses. */
export async function createAddress(
  db: TenantDb,
  customerId: string,
  input: AddressInput,
): Promise<{ id: string }> {
  const data = validateAddress(input);
  return db.run(async (tx) => {
    const count = await tx.address.count({ where: { customerId } });
    if (count >= MAX_ADDRESSES) {
      throw new CustomerError(
        "too_many",
        `You can save ${MAX_ADDRESSES} addresses at most. Remove one first.`,
      );
    }
    return tx.address.create({
      data: {
        ...data,
        tenantId: db.tenantId,
        customerId,
        isDefaultShipping: count === 0,
        isDefaultBilling: count === 0,
      },
      select: { id: true },
    });
  });
}

export async function updateAddress(
  db: TenantDb,
  customerId: string,
  addressId: string,
  input: AddressInput,
): Promise<void> {
  const data = validateAddress(input);
  await db.run(async (tx) => {
    await findOwn(tx, customerId, addressId);
    await tx.address.update({ where: { id: addressId }, data });
  });
}

/** Removes an address. If it was a default, the newest remaining one takes over. */
export async function deleteAddress(
  db: TenantDb,
  customerId: string,
  addressId: string,
): Promise<void> {
  await db.run(async (tx) => {
    const removed = await findOwn(tx, customerId, addressId);
    await tx.address.delete({ where: { id: addressId } });
    if (!removed.isDefaultShipping && !removed.isDefaultBilling) return;
    const heir = await tx.address.findFirst({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    if (!heir) return;
    await tx.address.update({
      where: { id: heir.id },
      data: {
        ...(removed.isDefaultShipping ? { isDefaultShipping: true } : {}),
        ...(removed.isDefaultBilling ? { isDefaultBilling: true } : {}),
      },
    });
  });
}

export type AddressUse = "shipping" | "billing";

export async function setDefaultAddress(
  db: TenantDb,
  customerId: string,
  addressId: string,
  use: AddressUse,
): Promise<void> {
  const column = use === "shipping" ? "isDefaultShipping" : "isDefaultBilling";
  await db.run(async (tx) => {
    await findOwn(tx, customerId, addressId);
    // Clear first: the database allows one default of each kind per customer.
    await tx.address.updateMany({
      where: { customerId, [column]: true },
      data: { [column]: false },
    });
    await tx.address.update({ where: { id: addressId }, data: { [column]: true } });
  });
}

/** An address as lines of text, in the order people in most countries expect. */
/** An address as lines; the country is named in the given language. */
export function formatAddress(address: ValidAddress, locale = "en"): string[] {
  return [
    address.fullName,
    address.line1,
    address.line2,
    [address.city, address.region, address.postalCode].filter(Boolean).join(", "),
    countryName(address.country, locale),
    address.phone,
  ].filter((line): line is string => Boolean(line));
}
