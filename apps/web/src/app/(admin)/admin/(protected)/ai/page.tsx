import { getAiOverview, hasPermission } from "@ecom/core";
import { Alert, Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import { aiLedger, aiSetup } from "@/server/ai";
import { requirePermission, tenantDb } from "@/server/access";
import {
  ActionForm,
  CheckboxField,
  SelectField,
  TextAreaField,
  TextField,
} from "../../_components/form";
import { saveAiSettingsAction, saveBusinessProfileAction } from "./actions";
import { TryAnswerForm } from "./try-form";

export const metadata: Metadata = { title: "AI assistant" };

const STATUS_TONE: Record<string, "success" | "warning" | "neutral"> = {
  ok: "success",
  paused: "neutral",
  over_budget: "warning",
  invalid_input: "warning",
  invalid_output: "warning",
  refused: "warning",
  provider_error: "warning",
};

const dollars = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;

// The AI assistant: what it knows about the business, what it may do alone,
// its budget, a place to try it, and the record of every run.
export default async function AiPage() {
  const { context } = await requirePermission("ai.use");
  const db = tenantDb(context);
  const setup = aiSetup();
  const overview = await getAiOverview(db, context, aiLedger(context.userId));
  const canConfigure = hasPermission(context, "ai.configure");
  const { settings, profile } = overview;
  const budgetMicros = Math.min(
    settings.monthlyBudgetMicros ?? setup.platformBudgetUsd * 1_000_000,
    setup.platformBudgetUsd * 1_000_000,
  );
  const paused = setup.globalPaused || settings.paused;
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI assistant"
        description="The AI drafts answers for your team from your own facts only: your products, delivery prices, policy pages and contact details. It never invents stock, prices, dates or rules, and a person checks its drafts."
      />

      {setup.provider === "mock" ? (
        <Alert tone="info" testId="ai-mock-notice">
          Test mode: answers come from a built-in stand-in, not a real AI, and cost nothing. Connect
          a real AI provider in the server settings (AI_PROVIDER, AI_API_KEY) to use it for real.
        </Alert>
      ) : null}

      <Card title="Status">
        <dl className="grid gap-3 text-sm sm:grid-cols-3" data-testid="ai-status">
          <div>
            <dt className="text-ink-muted">AI</dt>
            <dd>
              <Badge tone={paused ? "warning" : "success"}>{paused ? "Paused" : "On"}</Badge>
              {setup.globalPaused ? (
                <span className="ms-2 text-ink-muted">Paused for all stores by the platform.</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Model</dt>
            <dd>
              {setup.provider} · {setup.model}
              {setup.fallback ? (
                <span className="block text-ink-muted" data-testid="ai-fallback">
                  Backup: {setup.fallback.provider} · {setup.fallback.model}
                </span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Spent this month</dt>
            <dd data-testid="ai-spent">
              {dollars(overview.spentMicros)} of {dollars(budgetMicros)}
            </dd>
          </div>
        </dl>
      </Card>

      <Card
        title="Try it"
        description="Ask a question as a customer would. The answer is a draft; nothing is sent."
      >
        <TryAnswerForm languages={profile.languages} />
      </Card>

      {canConfigure ? (
        <Card
          title="Settings"
          description="Refunds, payment problems, complaints, legal and privacy questions and account problems always go to a person, whatever you choose."
        >
          <ActionForm
            action={saveAiSettingsAction}
            submitLabel="Save settings"
            testId="ai-settings-form"
          >
            <CheckboxField
              label="Pause AI for this store"
              name="paused"
              defaultChecked={settings.paused}
            />
            <SelectField
              label="What the AI may do alone"
              name="automation"
              defaultValue={settings.automation}
              options={[
                { value: "draft", label: "Only draft (staff copy what they want)" },
                { value: "approval", label: "Prepare answers that a person approves" },
                {
                  value: "auto",
                  label:
                    "Reply automatically to questions and everyday chat (refunds, complaints, payment, legal and privacy go to a person)",
                },
              ]}
            />
            <TextField
              label="Monthly budget (USD)"
              name="monthlyBudgetUsd"
              inputMode="decimal"
              hint={`Optional. At most the platform's limit of $${setup.platformBudgetUsd}. AI stops for the month when it is used up.`}
              defaultValue={
                settings.monthlyBudgetMicros === null
                  ? ""
                  : String(settings.monthlyBudgetMicros / 1_000_000)
              }
            />
          </ActionForm>
        </Card>
      ) : null}

      {canConfigure ? (
        <Card
          title="Business profile"
          description="What the AI is told about your business. It answers in your shop's languages."
        >
          <ActionForm
            action={saveBusinessProfileAction}
            submitLabel="Save profile"
            testId="ai-profile-form"
          >
            <TextField
              label="Business name"
              name="name"
              maxLength={100}
              defaultValue={profile.name}
            />
            <TextAreaField
              label="What the business does"
              name="description"
              rows={3}
              maxLength={2000}
              defaultValue={profile.description}
            />
            <TextField
              label="Tone of voice"
              name="tone"
              maxLength={300}
              defaultValue={profile.tone}
            />
            <TextAreaField
              label="It may promise (one per line)"
              name="mayPromise"
              rows={3}
              defaultValue={profile.mayPromise.join("\n")}
            />
            <TextAreaField
              label="It must never promise (one per line)"
              name="neverPromise"
              rows={3}
              defaultValue={profile.neverPromise.join("\n")}
            />
            <TextAreaField
              label="A person always handles (one per line)"
              name="handoverTopics"
              rows={4}
              defaultValue={profile.handoverTopics.join("\n")}
            />
            <TextField
              label="How customers reach a person"
              name="contact"
              maxLength={300}
              defaultValue={profile.contact}
            />
          </ActionForm>
        </Card>
      ) : null}

      <Card title="What it can look up">
        <ul className="list-disc ps-5 text-sm text-ink-muted" data-testid="ai-abilities">
          {overview.abilities.map((ability) => (
            <li key={ability.id}>{ability.description}</li>
          ))}
        </ul>
      </Card>

      <Card
        title="Recent runs"
        description="Every AI run is recorded for this store: what it cost and what happened."
      >
        {overview.recent.length === 0 ? (
          <p className="text-sm text-ink-muted">No runs yet.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line text-sm" data-testid="ai-runs">
            {overview.recent.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <Badge tone={STATUS_TONE[run.status] ?? "neutral"}>
                  {run.status.replace(/_/g, " ")}
                </Badge>
                <span>{run.task}</span>
                <span className="text-ink-muted">{when.format(run.createdAt)}</span>
                <span className="text-ink-muted">{dollars(run.costMicros)}</span>
                {run.problem ? <span className="w-full text-ink-muted">{run.problem}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
