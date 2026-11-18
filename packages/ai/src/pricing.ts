// What a model costs, in millionths of a US dollar per token (the same number
// as dollars per million tokens). Used to stop a business going over its
// monthly AI budget. A model not listed is charged at the most expensive
// listed price, so an unknown model can never overspend unnoticed.

const PRICES: Record<string, { input: number; output: number }> = {
  mock: { input: 0, output: 0 },
  "claude-fable-5-2": { input: 8, output: 40 },
  "claude-opus-5-5": { input: 4, output: 20 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
};

const MOST_EXPENSIVE = { input: 8, output: 40 };

export interface Prices {
  /** Dollars per million input tokens. */
  input: number;
  /** Dollars per million output tokens. */
  output: number;
}

/**
 * The cost of a run. Models in the table above use its prices; for others,
 * `prices` from the server's settings (a free test plan is 0 and 0), else
 * the most expensive known price.
 */
export function costMicros(
  model: string,
  inputTokens: number,
  outputTokens: number,
  prices?: Prices,
): number {
  const price = PRICES[model] ?? prices ?? MOST_EXPENSIVE;
  return Math.ceil(inputTokens * price.input + outputTokens * price.output);
}

export const dollarsToMicros = (dollars: number) => Math.round(dollars * 1_000_000);
