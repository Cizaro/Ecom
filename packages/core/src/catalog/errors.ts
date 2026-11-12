import { z } from "zod";
import { NotFoundError } from "../access/context";

export type CatalogErrorCode =
  | "invalid"
  | "slug_taken"
  | "sku_taken"
  | "has_children"
  | "parent_cycle"
  | "unknown_reference"
  | "needs_active_variant"
  | "last_active_variant";

/**
 * A request the catalog refuses for a reason the user can fix. The message is
 * written for the person using the admin and is safe to show.
 */
export class CatalogError extends Error {
  constructor(
    readonly code: CatalogErrorCode,
    message: string,
    /** The input field the problem is about, when there is one. */
    readonly field?: string,
  ) {
    super(message);
    this.name = "CatalogError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An identifier that is not a UUID cannot match any record. */
export function assertId(id: string, entity: string): void {
  if (!UUID.test(id)) throw new NotFoundError(entity);
}

/** Validates input with a Zod schema, reporting the first problem. */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0]!;
  throw new CatalogError("invalid", issue.message, issue.path.map(String).join(".") || undefined);
}

/** Prisma's error for a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === "P2002";
}

// Shared field rules.
export const nameField = (label: string) =>
  z
    .string({ error: `Enter a ${label}.` })
    .trim()
    .min(1, `Enter a ${label}.`)
    .max(200, `The ${label} is too long (200 characters at most).`);

export const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `${label} is too long (${max} characters at most).`)
    .transform((value) => (value === "" ? null : value))
    .nullish()
    .transform((value) => value ?? null);

export const optionalId = (label: string) =>
  z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullish()
    .transform((value) => value ?? null)
    .refine((value) => value === null || UUID.test(value), `Choose a ${label} from the list.`);

export const slugField = z
  .string()
  .trim()
  .max(120, "The URL name is too long (120 characters at most).")
  .regex(
    /^([a-z0-9]+(-[a-z0-9]+)*)?$/,
    "The URL name can use lowercase letters, digits and hyphens only.",
  )
  .optional();
