// Runs the AI evaluation set against the configured AI (AI_PROVIDER) and
// prints a score per group: answers from facts, honesty, languages,
// hand-over, trick messages, message labels and search words. Saves a
// report to eval-results/. Uses two made-up businesses, never a real store,
// and never touches a store's AI budget. Prints no secrets.
//
//   pnpm ai:eval                      every case
//   pnpm ai:eval --group injection    one group
//   pnpm ai:eval --delay 4000         slower, for a strict free plan

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVAL_CASES, reportMarkdown, runEvaluation } from "@ecom/ai";
import { EnvValidationError, parseEnv } from "@ecom/config";
import { aiProviderFromSettings } from "@ecom/core";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: the server sets real environment variables.
}

const args = process.argv.slice(2);
const option = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

let env;
try {
  env = parseEnv(process.env);
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(2);
  }
  throw error;
}

const group = option("--group");
const cases = group ? EVAL_CASES.filter((item) => item.group === group) : EVAL_CASES;
if (cases.length === 0) {
  const groups = [...new Set(EVAL_CASES.map((item) => item.group))].join(", ");
  console.error(`No cases in group "${group}". Groups: ${groups}`);
  process.exit(2);
}
const { provider, model, prices } = aiProviderFromSettings(env);
// Free plans allow few requests a minute; each case is one or two requests.
const free = env.AI_PROVIDER === "groq" || env.AI_PROVIDER === "moonshot";
const delayMs = Number(option("--delay") ?? (free ? 2500 : 0));

console.log(`Evaluating ${provider.name} (${model}) on ${cases.length} cases...\n`);
const report = await runEvaluation({
  provider,
  model,
  cases,
  delayMs,
  prices,
  onResult: (result, index) => {
    const mark = result.passed ? "PASS" : "FAIL";
    console.log(
      `${String(index + 1).padStart(2)}. ${mark} ${result.id} (${result.group}): ${result.note}`,
    );
    for (const problem of result.problems) console.log(`      - ${problem}`);
  },
});

console.log("\nScores:");
for (const [name, score] of Object.entries(report.scores)) {
  const pct = Math.round((score.passed / score.total) * 100);
  console.log(
    `  ${name.padEnd(10)} ${String(score.passed).padStart(2)} of ${String(score.total).padStart(2)}  ${pct}%`,
  );
}
console.log(`Cost: $${(report.costMicros / 1_000_000).toFixed(4)}`);

const when = new Date();
const folder = resolve(import.meta.dirname, "../eval-results");
mkdirSync(folder, { recursive: true });
const file = resolve(
  folder,
  `${when.toISOString().slice(0, 16).replace(/[:T]/g, "-")}-${provider.name.replace(/[^a-z0-9+-]/gi, "")}.md`,
);
writeFileSync(file, reportMarkdown(report, when));
console.log(`Report: ${file}`);
