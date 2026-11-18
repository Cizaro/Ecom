import { hasPermission, IDEA_STATUSES, listIdeas } from "@ecom/core";
import { Badge, Card, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm, TextField } from "../../../_components/form";
import { decideIdeaAction, draftIdeasAction } from "../actions";

export const metadata: Metadata = { title: "Research ideas" };

type Params = Record<string, string | string[] | undefined>;

const STATUS_LABEL = { new: "To review", accepted: "Kept", dismissed: "Dismissed" } as const;

// Opportunity ideas drafted by AI from the observations. Always labelled as
// suggestions, with the observations each one rests on.
export default async function IdeasPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { context } = await requirePermission("research.write");
  const asked = (await searchParams).status;
  const status = IDEA_STATUSES.find((s) => s === asked) ?? "new";
  const ideas = await listIdeas(tenantDb(context), context, { status });
  const canDraft = hasPermission(context, "ai.use");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Research ideas"
        description={
          <>
            Suggestions drafted by AI from what you observed. They are not facts: each shows the
            observations it rests on.{" "}
            <Link href="/admin/research" className="underline underline-offset-4">
              Competitors
            </Link>
          </>
        }
      />
      {canDraft ? (
        <Card title="Draft ideas">
          <ActionForm
            action={draftIdeasAction}
            submitLabel="Draft ideas with AI"
            testId="ideas-form"
          >
            <TextField
              label="About what (optional)"
              name="focus"
              maxLength={500}
              hint="For example: totes for summer, or prices."
            />
            <p className="text-xs text-ink-muted">
              Uses observations from the last six months. No fake urgency, fake reviews or copying
              others&apos; content is ever suggested.
            </p>
          </ActionForm>
        </Card>
      ) : null}
      <nav className="flex flex-wrap gap-3 text-sm" aria-label="Filter ideas">
        {IDEA_STATUSES.map((s) => (
          <Link
            key={s}
            href={`/admin/research/ideas?status=${s}`}
            className={status === s ? "font-semibold" : "underline underline-offset-4"}
          >
            {STATUS_LABEL[s]}
          </Link>
        ))}
      </nav>
      {ideas.length === 0 ? (
        <EmptyState title="No ideas here" />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="ideas">
          {ideas.map((idea) => (
            <li
              key={idea.id}
              className="flex flex-col gap-2 rounded-card border border-line p-4 text-sm"
              data-testid="idea"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  tone={idea.score >= 70 ? "success" : idea.score >= 40 ? "warning" : "neutral"}
                >
                  Score {idea.score}
                </Badge>
                <Badge tone="neutral">AI suggestion</Badge>
                <span className="font-medium">{idea.title}</span>
              </div>
              <p className="whitespace-pre-line">{idea.idea}</p>
              <p className="text-ink-muted">Why: {idea.rationale}</p>
              <div className="text-xs text-ink-muted">
                Based on:{" "}
                {idea.cites.length === 0
                  ? "observations since deleted"
                  : idea.cites.map((c, index) => (
                      <span key={c.id}>
                        {index > 0 ? "; " : ""}
                        {c.competitor}, {c.observedOn}: “{c.title}”
                      </span>
                    ))}
                {idea.model ? ` · drafted by ${idea.model}` : ""}
              </div>
              {idea.status === "new" ? (
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={decideIdeaAction} submitLabel="Keep" testId="idea-keep">
                    <input type="hidden" name="id" value={idea.id} />
                    <input type="hidden" name="decision" value="accepted" />
                  </ActionForm>
                  <ActionForm
                    action={decideIdeaAction}
                    submitLabel="Dismiss"
                    submitTone="secondary"
                  >
                    <input type="hidden" name="id" value={idea.id} />
                    <input type="hidden" name="decision" value="dismissed" />
                  </ActionForm>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
