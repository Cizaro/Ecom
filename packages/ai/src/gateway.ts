import { costMicros, type Prices } from "./pricing";
import { TASKS, type TaskDefinition, type TaskName } from "./tasks";
import {
  ProviderError,
  type AiLedger,
  type AiProvider,
  type BusinessProfile,
  type Fact,
  type KnowledgeSource,
  type Route,
  type RunStatus,
} from "./types";

// The AI gateway: the only way any part of the platform uses AI. For each
// request: stop if AI is paused (everywhere or for this business) or the
// business is over its monthly budget; check the input; gather verified
// facts; remove personal details; build the prompt; call the provider with
// a time limit; check the answer against its schema and the task's rules
// (one second try with the problems pointed out); decide who must look at
// the result; record everything in the business's own audit trail.

export interface GatewayOptions {
  provider: AiProvider;
  ledger: AiLedger;
  model: string;
  /** Platform switch: true stops every task for every business. */
  globalPaused: boolean;
  /** The most any one business may spend in a month, in millionths of a dollar. */
  platformMonthlyBudgetMicros: number;
  timeoutMs?: number;
  now?: () => Date;
  /** What the configured model costs, when the built-in price list does not know it. */
  prices?: Prices;
}

export interface RunContext {
  tenantId: string;
  profile: BusinessProfile;
  knowledge: KnowledgeSource;
}

/** What a task, by name, answers. */
export type TaskOutput<Name extends TaskName> =
  (typeof TASKS)[Name] extends TaskDefinition<infer _Input, infer Output> ? Output : never;

export type RunResult<Output> =
  | { ok: true; output: Output; facts: Fact[]; route: Route; eventId: string }
  | { ok: false; status: Exclude<RunStatus, "ok">; message: string; eventId: string };

const MESSAGES: Record<Exclude<RunStatus, "ok">, string> = {
  paused: "AI is paused.",
  over_budget: "This month's AI budget is used up.",
  invalid_input: "The request could not be used.",
  invalid_output: "The AI's answer did not pass the checks, so it was not used.",
  refused: "The AI declined this request.",
  provider_error: "The AI service could not be reached. Try again later.",
};

export function createGateway(options: GatewayOptions) {
  const now = options.now ?? (() => new Date());
  const timeoutMs = options.timeoutMs ?? 60_000;

  async function run<Input, Output>(
    task: TaskDefinition<Input, Output>,
    rawInput: unknown,
    context: RunContext,
  ): Promise<RunResult<Output>> {
    const started = Date.now();
    let inputTokens = 0;
    let outputTokens = 0;
    let model = options.model;
    let recordedInput: unknown = null;
    let facts: Fact[] = [];

    const finish = async (
      status: RunStatus,
      extra: { route?: Route; output?: unknown; problem?: string } = {},
    ) =>
      options.ledger.record({
        tenantId: context.tenantId,
        task: task.name,
        provider: options.provider.name,
        model,
        status,
        route: extra.route ?? null,
        inputTokens,
        outputTokens,
        costMicros: costMicros(model, inputTokens, outputTokens, options.prices),
        latencyMs: Date.now() - started,
        problem: extra.problem ?? null,
        input: recordedInput,
        output: extra.output ?? null,
        factIds: facts.map((fact) => fact.id),
      });
    const fail = async (status: Exclude<RunStatus, "ok">, problem?: string) => ({
      ok: false as const,
      status,
      message: MESSAGES[status],
      eventId: await finish(status, { problem: problem ?? MESSAGES[status] }),
    });

    // 1. Switched off?
    const settings = await options.ledger.settings(context.tenantId);
    if (options.globalPaused || settings.paused) {
      return fail("paused", options.globalPaused ? "Paused for all businesses." : undefined);
    }
    // 2. Budget left? The smaller of the business's own limit and the platform's.
    const budget = Math.min(
      settings.monthlyBudgetMicros ?? options.platformMonthlyBudgetMicros,
      options.platformMonthlyBudgetMicros,
    );
    if ((await options.ledger.spentThisMonth(context.tenantId, now())) >= budget) {
      return fail("over_budget");
    }
    // 3. Input, minimized before it goes anywhere.
    const parsed = task.input.safeParse(rawInput);
    if (!parsed.success) return fail("invalid_input");
    const input = task.minimize(parsed.data);
    recordedInput = input;
    // 4. Facts, from the business's own source only.
    facts = await task.gatherFacts(input, context.knowledge);
    const taskContext = { input, profile: context.profile, facts };
    const prompt = task.prompt(taskContext);

    // 5. The provider, then the checks; a second try names the problems.
    let problems: string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      const user =
        attempt === 0
          ? prompt.user
          : `${prompt.user}\n\nYour previous answer was not used because: ${problems.join(" ")} Answer again following the rules.`;
      let result;
      try {
        result = await options.provider.complete({
          task: task.name,
          model: options.model,
          system: prompt.system,
          user,
          schema: task.output,
          maxTokens: task.maxTokens,
          effort: task.effort,
          timeoutMs,
          mockOutput: () => task.mock(taskContext),
        });
      } catch (error) {
        if (error instanceof ProviderError) return fail("provider_error", error.message);
        throw error;
      }
      model = result.model;
      inputTokens += result.inputTokens;
      outputTokens += result.outputTokens;
      if (result.stop === "refused") return fail("refused");

      const output = task.output.safeParse(result.output);
      problems = output.success
        ? task.check(output.data, taskContext)
        : [
            result.stop === "truncated"
              ? "The answer was cut off."
              : "The answer was not in the required format.",
          ];
      if (output.success && problems.length === 0) {
        // 6. Who looks at it before it is used.
        const risky = task.risk(output.data, taskContext) === "high";
        const route: Route =
          settings.automation === "auto" && !risky
            ? "auto"
            : settings.automation === "draft"
              ? "draft"
              : "needs_approval";
        const eventId = await finish("ok", { route, output: output.data });
        return { ok: true, output: output.data, facts, route, eventId };
      }
    }
    return fail("invalid_output", problems.join(" "));
  }

  return {
    /**
     * Whether AI may run for this business now (not paused, budget left),
     * without recording anything: for background work that would otherwise
     * log a refused run on every pass.
     */
    async available(tenantId: string): Promise<boolean> {
      const settings = await options.ledger.settings(tenantId);
      if (options.globalPaused || settings.paused) return false;
      const budget = Math.min(
        settings.monthlyBudgetMicros ?? options.platformMonthlyBudgetMicros,
        options.platformMonthlyBudgetMicros,
      );
      return (await options.ledger.spentThisMonth(tenantId, now())) < budget;
    },
    providerName: options.provider.name,
    model: options.model,
    /** Runs a task by name. */
    run<Name extends TaskName>(
      name: Name,
      input: unknown,
      context: RunContext,
    ): Promise<RunResult<TaskOutput<Name>>> {
      // TASKS[name] is a union once there is more than one task; the name ties
      // it to one definition, which TypeScript cannot follow by itself.
      const task = TASKS[name] as unknown as TaskDefinition<unknown, TaskOutput<Name>>;
      return run(task, input, context);
    },
    /** Runs a task definition directly (tests and future tasks). */
    runTask: run,
  };
}

export type AiGateway = ReturnType<typeof createGateway>;
