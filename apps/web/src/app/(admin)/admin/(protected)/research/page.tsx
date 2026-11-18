import { listCompetitors, recentObservations } from "@ecom/core";
import { Card, EmptyState, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm } from "../../_components/form";
import { saveCompetitorAction } from "./actions";
import { CompetitorFields } from "./competitor-fields";
import { ObservationList } from "./observation-list";

export const metadata: Metadata = { title: "Competitor research" };

type Params = Record<string, string | string[] | undefined>;

// The competitors the store watches and what staff saw lately. Everything
// here is typed by staff from what they saw themselves.
export default async function ResearchPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { context } = await requirePermission("research.write");
  const archived = (await searchParams).archived === "1";
  const db = tenantDb(context);
  const [competitors, recent] = await Promise.all([
    listCompetitors(db, context, { archived }),
    archived ? Promise.resolve([]) : recentObservations(db, context, { limit: 10 }),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Competitor research"
        description={
          <>
            What your competitors sell, charge and post, as you saw it, with where and when.{" "}
            <Link href="/admin/research/ideas" className="underline underline-offset-4">
              Ideas
            </Link>
          </>
        }
      />
      <div className="text-sm">
        <Link
          href={archived ? "/admin/research" : "/admin/research?archived=1"}
          className="underline underline-offset-4"
        >
          {archived ? "Show current competitors" : "Show archived competitors"}
        </Link>
      </div>
      {competitors.length === 0 ? (
        <EmptyState title={archived ? "No archived competitors" : "No competitors yet"} />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2" data-testid="competitors">
          {competitors.map((c) => (
            <li
              key={c.id}
              className="flex flex-col gap-1 rounded-card border border-line p-3 text-sm"
            >
              <Link
                href={`/admin/research/${c.id}`}
                className="font-medium underline-offset-4 hover:underline"
              >
                {c.name}
              </Link>
              <span className="text-ink-muted">
                {c.observationCount} {c.observationCount === 1 ? "observation" : "observations"}
                {c.lastObservedOn ? ` · last ${c.lastObservedOn}` : ""}
                {c.tags.length ? ` · ${c.tags.join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recent.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Seen lately</h2>
          <ObservationList observations={recent} showCompetitor />
        </section>
      ) : null}
      {!archived ? (
        <Card title="Add a competitor">
          <ActionForm
            action={saveCompetitorAction}
            submitLabel="Add competitor"
            testId="competitor-form"
          >
            <CompetitorFields />
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
