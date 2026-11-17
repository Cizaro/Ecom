import { z } from "zod";
import { asData, factsSection, GROUNDING_RULES, profileSection, redactPersonal } from "./prompt";
import type { BusinessProfile, Fact, KnowledgeSource } from "./types";

// AI tasks: each is a name, a checked input, a prompt built from the
// business profile and facts, a checked output, the business rules the
// output must meet, and how risky its result is. Callers ask for a task by
// name; nothing outside this module talks to a provider.

export interface TaskContext<Input> {
  input: Input;
  profile: BusinessProfile;
  facts: Fact[];
}

export interface TaskDefinition<Input, Output> {
  name: string;
  /** What it does, for staff. */
  description: string;
  input: z.ZodType<Input>;
  output: z.ZodType<Output>;
  maxTokens: number;
  effort: "low" | "medium" | "high";
  /** The facts this run may use. */
  gatherFacts(input: Input, knowledge: KnowledgeSource): Promise<Fact[]>;
  /** The input with personal details removed, as it is sent and recorded. */
  minimize(input: Input): Input;
  prompt(context: TaskContext<Input>): { system: string; user: string };
  /** Problems with an output that passed its schema; empty when it may be used. */
  check(output: Output, context: TaskContext<Input>): string[];
  /** "high" results always go to a person first. */
  risk(output: Output, context: TaskContext<Input>): "low" | "high";
  /** What a well-behaved model answers, for the mock provider. */
  mock(context: TaskContext<Input>): Output;
}

// --- customer.answer -------------------------------------------------------------

/** Subjects a person always handles, whatever the business's settings. */
export const ALWAYS_HUMAN_TOPICS = [
  "refund",
  "payment_problem",
  "legal",
  "threat",
  "privacy",
  "complaint",
  "account",
] as const;

const TOPICS = ["question", ...ALWAYS_HUMAN_TOPICS, "other"] as const;

const answerInput = z.object({
  /** What the customer wrote. Untrusted. */
  question: z.string().trim().min(1).max(4000),
  /** The language to answer in, as a code. */
  language: z.string().regex(/^[a-z]{2}$/),
});

const answerOutput = z.object({
  /** Whether the facts answered the question. */
  answered: z.boolean(),
  reply: z.string().min(1).max(2000),
  /** Ids of the facts the reply relies on. */
  citations: z.array(z.string()).max(20),
  topic: z.enum(TOPICS),
  /** A person should take over. */
  handover: z.boolean(),
});

export type CustomerAnswerInput = z.infer<typeof answerInput>;
export type CustomerAnswerOutput = z.infer<typeof answerOutput>;

/** Every number in a text ("12", "4.50", "9:30"), as written. */
const numbersIn = (text: string) => text.match(/\d+(?:[.,:]\d+)*/g) ?? [];

export const customerAnswerTask: TaskDefinition<CustomerAnswerInput, CustomerAnswerOutput> = {
  name: "customer.answer",
  description: "Drafts a reply to a customer's question from the business's facts only.",
  input: answerInput,
  output: answerOutput,
  maxTokens: 2000,
  effort: "low",
  async gatherFacts(input, knowledge) {
    return knowledge.search(input.question, { limit: 12, language: input.language });
  },
  minimize(input) {
    return { ...input, question: redactPersonal(input.question) };
  },
  prompt({ input, profile, facts }) {
    return {
      system: [
        profileSection(profile),
        "",
        "Your job: draft a reply to the customer's message below, for a member of staff to check.",
        GROUNDING_RULES,
        `- Reply in the language with code "${input.language}".`,
        "- Set answered to false when the facts do not answer the question; then citations may be empty.",
        "- Choose the topic that fits the message; set handover to true when a person should take over.",
      ].join("\n"),
      user: [
        factsSection(facts),
        "",
        "<customer_message>",
        asData(input.question),
        "</customer_message>",
      ].join("\n"),
    };
  },
  check(output, { input, facts }) {
    const problems: string[] = [];
    const ids = new Set(facts.map((fact) => fact.id));
    const unknown = output.citations.filter((id) => !ids.has(id));
    if (unknown.length > 0)
      problems.push(`It cites facts that were not given: ${unknown.join(", ")}.`);
    if (output.answered && output.citations.length === 0) {
      problems.push("It says it answered but cites no fact.");
    }
    // Every number in the reply must come from a cited fact or the question:
    // the checked guarantee that no amount, date or quantity is invented.
    const cited = facts.filter((fact) => output.citations.includes(fact.id));
    const allowed = new Set([
      ...cited.flatMap((fact) => numbersIn(fact.text)),
      ...numbersIn(input.question),
    ]);
    const invented = numbersIn(output.reply).filter((number) => !allowed.has(number));
    if (invented.length > 0) {
      problems.push(`It states numbers no cited fact contains: ${invented.join(", ")}.`);
    }
    return problems;
  },
  risk(output) {
    return output.handover ||
      !output.answered ||
      (ALWAYS_HUMAN_TOPICS as readonly string[]).includes(output.topic)
      ? "high"
      : "low";
  },
  mock({ facts }) {
    // Answers with the first fact, quoted, or says it does not know.
    const fact = facts[0];
    return fact
      ? {
          answered: true,
          reply: fact.text,
          citations: [fact.id],
          topic: "question",
          handover: false,
        }
      : {
          answered: false,
          reply:
            "I do not have that information. I will pass your question to a member of our team.",
          citations: [],
          topic: "other",
          handover: true,
        };
  },
};

/** Every task the gateway runs, by name. */
export const TASKS = {
  "customer.answer": customerAnswerTask,
} as const;

export type TaskName = keyof typeof TASKS;
