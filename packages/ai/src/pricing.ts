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

export function costMicros(model: string, inputTokens: number, outputTokens: number): number {
  const price = PRICES[model] ?? MOST_EXPENSIVE;
  return Math.ceil(inputTokens * price.input + outputTokens * price.output);
}

export const dollarsToMicros = (dollars: number) => Math.round(dollars * 1_000_000);
