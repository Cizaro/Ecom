import { Alert, Card, List, ListItem, PageHeader } from "@ecom/ui";
import Link from "next/link";
import { getAccessOutcome } from "@/server/access";
import { requireSession } from "@/server/auth";

// Placeholder home for signed-in staff. The real dashboard is Milestone 3.7.
export default async function AdminHomePage() {
  const session = await requireSession();
  const { user, memberships } = session;
  const outcome = await getAccessOutcome();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Admin"
        description={`Signed in as ${user.name || user.email}. The dashboard is under construction.`}
      />

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
