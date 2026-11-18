import { createGateway, type AiGateway } from "../gateway";
import { dollarsToMicros } from "../pricing";
import { TASKS } from "../tasks";
import type { AiEvent, AiLedger, AiProvider } from "../types";
import { EVAL_BUSINESSES, type EvalCase, type Expect } from "./cases";

// Runs the evaluation set against a provider and scores it. Each run goes
// through the real gateway (the same checks as in the shop), with a ledger
// kept in memory: an evaluation never touches a store's data or budget.

export interface CaseResult {
  id: string;
  task: EvalCase["task"];
  group: EvalCase["group"];
  note: string;
  passed: boolean;
  /** What did not match, in words. */
  problems: string[];
  /** What the gateway did: ok, or why it refused. */
  outcome: string;
  /** The model's output (or nothing when refused). */
  output: unknown;
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  latencyMs: number;
}

export interface EvalReport {
  provider: string;
  model: string;
  results: CaseResult[];
  /** Passed and total per group, and overall. */
  scores: Record<string, { passed: number; total: number }>;
  costMicros: number;
}

const ARABIC = /[؀-ۿ]/;
const lower = (value: unknown) => String(value ?? "").toLowerCase();

/** Problems with one result; empty when it is what a good model does. */
export function judge(expect: Expect, outcome: string, output: unknown): string[] {
  if (outcome !== "ok") {
    return expect.blockedOk ? [] : [`The gateway did not use the answer (${outcome}).`];
  }
  const out = (output ?? {}) as Record<string, unknown>;
  const reply = String(out.reply ?? "");
  const text = lower(reply);
  const citations = Array.isArray(out.citations) ? (out.citations as string[]) : [];
  const problems: string[] = [];

  if (expect.answered !== undefined && out.answered !== expect.answered) {
    problems.push(
      expect.answered ? "Did not answer from the facts." : "Claimed to answer without facts.",
    );
  }
  if (expect.handover && out.handover !== true) problems.push("Did not hand over to a person.");
  if (expect.topicIn && !expect.topicIn.includes(String(out.topic))) {
    problems.push(`Topic was ${String(out.topic)}, expected ${expect.topicIn.join(" or ")}.`);
  }
  for (const id of expect.cites ?? []) {
    if (!citations.includes(id)) problems.push(`Did not cite ${id}.`);
  }
  if (expect.citesAny && !expect.citesAny.some((id) => citations.includes(id))) {
    problems.push(`Cited none of ${expect.citesAny.join(", ")}.`);
  }
  if (expect.includesAny && !expect.includesAny.some((part) => text.includes(part.toLowerCase()))) {
    problems.push(`The reply has none of: ${expect.includesAny.join(", ")}.`);
  }
  for (const pattern of expect.excludes ?? []) {
    if (new RegExp(pattern, "i").test(reply))
      problems.push(`The reply contains what it must not (${pattern}).`);
  }
  if (expect.script === "arabic" && !ARABIC.test(reply))
    problems.push("Not written in Arabic letters.");
  if (expect.script === "latin" && ARABIC.test(reply)) problems.push("Written in Arabic letters.");
  if (expect.arabizi) {
    const arabizi = !ARABIC.test(reply) && /\p{L}[2378]|[2378]\p{L}/u.test(reply);
    if (!arabizi) problems.push("Not written in Lebanese Arabic with Latin letters.");
  }
  if (expect.categoryIn && !expect.categoryIn.includes(String(out.category))) {
    problems.push(`Labelled ${String(out.category)}, expected ${expect.categoryIn.join(" or ")}.`);
  }
  if (expect.urgency && out.urgency !== expect.urgency) {
    problems.push(`Urgency was ${String(out.urgency)}, expected ${expect.urgency}.`);
  }
  if (expect.language && out.language !== expect.language) {
    problems.push(`Language was ${String(out.language)}, expected ${expect.language}.`);
  }
  if (expect.termsIncludeAny) {
    const terms = (Array.isArray(out.terms) ? (out.terms as string[]) : []).map(lower).join(" ");
    if (!expect.termsIncludeAny.some((term) => terms.includes(term))) {
      problems.push(`Search words had none of: ${expect.termsIncludeAny.join(", ")}.`);
    }
  }
  return problems;
}

/** A ledger in memory: never paused, never over budget, keeps the events for the report. */
function memoryLedger(events: AiEvent[]): AiLedger {
  return {
    settings: async () => ({ paused: false, monthlyBudgetMicros: null, automation: "draft" }),
    spentThisMonth: async () => 0,
    record: async (event) => {
      events.push(event);
      return `eval-${events.length}`;
    },
  };
}

export async function runEvaluation(options: {
  provider: AiProvider;
  model: string;
  cases: EvalCase[];
  /** Pause between runs, to stay inside a provider's rate limit. */
  delayMs?: number;
  prices?: { input: number; output: number };
  /** When the provider is busy (rate limit), wait this long and try the case again (twice at most). */
  busyWaitMs?: number;
  onResult?: (result: CaseResult, index: number) => void;
}): Promise<EvalReport> {
  const events: AiEvent[] = [];
  const gateway: AiGateway = createGateway({
    provider: options.provider,
    ledger: memoryLedger(events),
    model: options.model,
    prices: options.prices,
    globalPaused: false,
    platformMonthlyBudgetMicros: dollarsToMicros(1_000),
  });
  const results: CaseResult[] = [];
  for (const [index, item] of options.cases.entries()) {
    if (index > 0 && options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    const business = EVAL_BUSINESSES[item.business];
    const before = events.length;
    const runOnce = () =>
      gateway.runTask(TASKS[item.task] as Parameters<AiGateway["runTask"]>[0], item.input, {
        tenantId: "eval",
        profile: business.profile,
        knowledge: business.knowledge,
      });
    let run = await runOnce();
    // A busy provider says nothing about the model: wait, then try again.
    for (let retry = 0; retry < 2 && !run.ok && run.status === "provider_error"; retry++) {
      if (!/busy/.test(events[events.length - 1]?.problem ?? "")) break;
      await new Promise((r) => setTimeout(r, options.busyWaitMs ?? 20_000));
      run = await runOnce();
    }
    const event = events[events.length - 1] ?? null;
    const outcome = run.ok ? "ok" : run.status;
    const output = run.ok ? run.output : null;
    const problems = judge(item.expect, outcome, output);
    if (!run.ok && event?.problem && !item.expect.blockedOk) problems.push(`Why: ${event.problem}`);
    const result: CaseResult = {
      id: item.id,
      task: item.task,
      group: item.group,
      note: item.note,
      passed: problems.length === 0,
      problems,
      outcome,
      output,
      inputTokens: events.slice(before).reduce((sum, e) => sum + e.inputTokens, 0),
      outputTokens: events.slice(before).reduce((sum, e) => sum + e.outputTokens, 0),
      costMicros: events.slice(before).reduce((sum, e) => sum + e.costMicros, 0),
      latencyMs: events.slice(before).reduce((sum, e) => sum + e.latencyMs, 0),
    };
    results.push(result);
    options.onResult?.(result, index);
  }
  const scores: EvalReport["scores"] = { overall: { passed: 0, total: 0 } };
  for (const result of results) {
    scores[result.group] ??= { passed: 0, total: 0 };
    for (const key of [result.group, "overall"]) {
      scores[key]!.total++;
      if (result.passed) scores[key]!.passed++;
    }
  }
  return {
    provider: options.provider.name,
    model: options.model,
    results,
    scores,
    costMicros: results.reduce((sum, r) => sum + r.costMicros, 0),
  };
}

/** The report as Markdown, for a file. */
export function reportMarkdown(report: EvalReport, when: Date): string {
  const pct = ({ passed, total }: { passed: number; total: number }) =>
    total === 0 ? "-" : `${Math.round((passed / total) * 100)}%`;
  const lines = [
    `# AI evaluation: ${report.provider} (${report.model})`,
    "",
    `${when.toISOString()} · ${report.results.length} cases · cost $${(report.costMicros / 1_000_000).toFixed(4)}`,
    "",
    "| Group | Passed | Score |",
    "| --- | --- | --- |",
    ...Object.entries(report.scores).map(
      ([group, score]) => `| ${group} | ${score.passed} of ${score.total} | ${pct(score)} |`,
    ),
    "",
    "## Cases",
    "",
    ...report.results.flatMap((r) => [
      `### ${r.passed ? "PASS" : "FAIL"} ${r.id} (${r.group}): ${r.note}`,
      "",
      ...(r.problems.length > 0 ? r.problems.map((p) => `- ${p}`) : ["- As expected."]),
      `- Outcome: ${r.outcome}; ${r.latencyMs} ms`,
      ...(r.output ? ["", "```json", JSON.stringify(r.output, null, 2), "```"] : []),
      "",
    ]),
  ];
  return lines.join("\n");
}
