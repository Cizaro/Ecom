import type { z } from "zod";

// The AI module's vocabulary. Nothing here knows what the business sells,
// or that it sells anything: business facts come in through a knowledge
// source, and what the business is comes from its profile (decision D88,
// docs/REUSE.md). The module never imports the shop's code.

/** One verified fact the AI may use, with an id it must cite. */
export interface Fact {
  /** Stable within one run, for example "service:cleaning" or "policy:returns#2". */
  id: string;
  /** What kind of fact, chosen by the business's adapter ("service", "policy", ...). */
  kind: string;
  /** The fact in plain words. Only this text reaches the model. */
  text: string;
}

/** Something the business's adapter can look up for the AI. */
export interface Ability {
  id: string;
  /** What it finds, in plain words (shown to staff). */
  description: string;
}

/**
 * Where business facts come from. The shop supplies one that reads its
 * catalog, delivery areas and policies; a clinic, a restaurant or a folder of
 * documents supplies another, and the AI works unchanged.
 */
export interface KnowledgeSource {
  /** The lookups this source offers. */
  abilities(): Ability[];
  /** Facts relevant to a question, most relevant first. Never invents anything. */
  search(question: string, options: { limit: number; language: string }): Promise<Fact[]>;
}

/** What the business is and how it speaks: data staff edit, not code. */
export interface BusinessProfile {
  name: string;
  /** What the business does, in a few sentences. */
  description: string;
  /** How replies should sound ("warm and short", ...). */
  tone: string;
  /** Languages replies may be written in, as codes ("en", "ar"). */
  languages: string[];
  /** Things the business is happy to promise. */
  mayPromise: string[];
  /** Things replies must never promise. */
  neverPromise: string[];
  /** Subjects a person always handles. */
  handoverTopics: string[];
  /** How a customer reaches a person. */
  contact: string;
}

/** Who decides what happens to an AI result. */
export type Automation = "draft" | "approval" | "auto";
export type Route = "draft" | "needs_approval" | "auto";

export interface TenantAiSettings {
  /** Staff paused AI for this business. */
  paused: boolean;
  /** This business's own monthly limit, in millionths of a US dollar; null for the platform limit. */
  monthlyBudgetMicros: number | null;
  automation: Automation;
}

export type RunStatus =
  | "ok"
  | "paused"
  | "over_budget"
  | "invalid_input"
  | "invalid_output"
  | "refused"
  | "provider_error";

/** One line of the audit trail, kept per business. */
export interface AiEvent {
  tenantId: string;
  task: string;
  provider: string;
  model: string;
  status: RunStatus;
  route: Route | null;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  latencyMs: number;
  /** What went wrong, in words; never a secret or a raw provider message with data in it. */
  problem: string | null;
  /** The input as sent (after personal details are removed). */
  input: unknown;
  /** The checked output, when there is one. */
  output: unknown;
  /** Ids of the facts the run was given. */
  factIds: string[];
}

/** Where the gateway keeps settings, spend and the audit trail. */
export interface AiLedger {
  settings(tenantId: string): Promise<TenantAiSettings>;
  /** Spent since the start of this calendar month (UTC), in millionths of a dollar. */
  spentThisMonth(tenantId: string, now: Date): Promise<number>;
  record(event: AiEvent): Promise<string>;
}

// --- Providers -----------------------------------------------------------------

export interface ProviderRequest {
  task: string;
  model: string;
  system: string;
  user: string;
  schema: z.ZodType;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  timeoutMs: number;
  /** For the mock provider only: what a well-behaved model would answer. */
  mockOutput: () => unknown;
}

export interface ProviderResult {
  output: unknown;
  stop: "ok" | "refused" | "truncated";
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AiProvider {
  readonly name: string;
  complete(request: ProviderRequest): Promise<ProviderResult>;
}

/** A provider call that failed for a reason worth reporting. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
