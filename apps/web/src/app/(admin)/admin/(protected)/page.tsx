import { getDashboard, getSetupChecklist, hasPermission } from "@ecom/core";
import { Alert, Card, List, ListItem, PageHeader } from "@ecom/ui";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getAccessOutcome, tenantDb } from "@/server/access";
import { requireSession } from "@/server/auth";
import { DashboardView } from "./_components/dashboard";
import { SetupGuide } from "./_components/setup-guide";

// Home for signed-in staff: the store dashboard for those who may see
// reports, then their access.
export default async function AdminHomePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { user, memberships } = session;
  // The platform owner with no shop of their own goes straight to the platform panel (D120).
  if (user.isPlatformAdmin && memberships.length === 0) redirect("/admin/platform");
  const outcome = await getAccessOutcome();
  const dashboard =
    outcome.status === "ok" && hasPermission(outcome.context, "reports.read")
      ? await getDashboard(tenantDb(outcome.context), outcome.context)
      : null;
  const checklist =
    // The setup steps lead to settings pages, so only for those who may change them.
    outcome.status === "ok" && hasPermission(outcome.context, "settings.write")
      ? await getSetupChecklist(tenantDb(outcome.context))
      : null;
  const welcome = (await searchParams).welcome === "1";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={dashboard ? "Dashboard" : "Admin"}
        description={`Signed in as ${user.name || user.email}.`}
      />

      {checklist ? <SetupGuide checklist={checklist} welcome={welcome} /> : null}

      {dashboard ? <DashboardView data={dashboard} /> : null}

      {outcome.status === "choose_tenant" ? (
        <Alert tone="info">
          You work in more than one store.{" "}
          <Link href="/admin/select-store" className="font-medium underline underline-offset-4">
            Choose a store
          </Link>{" "}
          to continue.
        </Alert>
      ) : null}

      <Card title="Your access">
        {memberships.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {user.isPlatformAdmin
              ? "You are a platform administrator and are not a member of any store."
              : "You are not a member of any store yet. Ask a store owner to add you."}
          </p>
        ) : (
          <List>
            {memberships.map((membership) => (
              <ListItem key={membership.tenantId}>
                <span className="font-medium">{membership.tenantName}</span>
                <span className="text-sm text-ink-muted">{membership.roleName}</span>
              </ListItem>
            ))}
          </List>
        )}
      </Card>

      {!user.twoFactorEnabled ? (
        <Alert tone="warning">
          Two-factor authentication is off for your account.{" "}
          <Link href="/admin/account/security" className="font-medium underline underline-offset-4">
            Turn it on
          </Link>
        </Alert>
      ) : null}
    </div>
  );
}
