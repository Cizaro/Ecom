import { z } from "zod";
import type { BusinessProfile } from "./types";

// The business profile as staff edit it, checked before it is saved or used.

const line = z.string().trim().min(1).max(300);

export const businessProfileSchema = z.object({
  name: z.string().trim().min(1, "Enter the business name.").max(100),
  description: z
    .string()
    .trim()
    .min(10, "Describe the business in a sentence or two.")
    .max(2000, "Shorten the description (2,000 characters at most)."),
  tone: z.string().trim().min(1, "Describe the tone.").max(300),
  languages: z
    .array(z.string().regex(/^[a-z]{2}$/))
    .min(1)
    .max(5),
  mayPromise: z.array(line).max(20),
  neverPromise: z.array(line).max(20),
  handoverTopics: z.array(line).max(20),
  contact: z.string().trim().max(300).default(""),
}) satisfies z.ZodType<BusinessProfile>;

/** A starting profile for a business that has not written its own yet. */
export function defaultProfile(name: string, languages: string[] = ["en"]): BusinessProfile {
  return {
    name,
    description: `${name} answers its customers' questions politely and accurately.`,
    tone: "Friendly, clear and short.",
    languages,
    mayPromise: [],
    neverPromise: ["Discounts, refunds or exceptions not stated in the facts."],
    handoverTopics: [
      "Refunds and payment problems",
      "Complaints and upset customers",
      "Legal questions, threats and privacy requests",
      "Account problems",
    ],
    contact: "",
  };
}

/** A stored profile, or the default when it is missing or no longer valid. */
export function readProfile(
  value: unknown,
  fallbackName: string,
  languages?: string[],
): BusinessProfile {
  const parsed = businessProfileSchema.safeParse(value);
  return parsed.success ? parsed.data : defaultProfile(fallbackName, languages);
}
