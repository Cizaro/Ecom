import { getRequireStaffTwoFactor, listTeamMembers } from "@ecom/core";
import { Badge, Card, EmptyState, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import { requirePermission, tenantDb } from "@/server/access";
import { ActionForm, CheckboxField } from "../../_components/form";
import { setRequireTwoFactorAction } from "./actions";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { context } = await requirePermission("staff.manage");
  const db = tenantDb(context);
  const members = await listTeamMembers(db);
  const required = await getRequireStaffTwoFactor(db);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Team"
        description={`Staff of ${context.tenantName}. Inviting and editing staff comes with store settings.`}
      />

      {members.length === 0 ? (
        <EmptyState title="No staff yet" />
      ) : (
        <List testId="team-list">
          {members.map((member) => (
            <ListItem key={member.userId}>
              <div className="min-w-0">
                <p className="truncate font-medium">{member.name || member.email}</p>
                <p className="truncate text-sm text-ink-muted" data-testid="team-member-email">
                  {member.email}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <span>{member.roleName}</span>
                {member.status === "active" ? null : <Badge tone="warning">{member.status}</Badge>}
                <Badge tone={member.twoFactorEnabled ? "success" : "neutral"}>
                  Two-factor {member.twoFactorEnabled ? "on" : "off"}
                </Badge>
              </div>
            </ListItem>
          ))}
        </List>
      )}

      {context.roleKey === "store_owner" ? (
        <Card
          title="Two-factor sign-in"
          description="A code from a phone app on top of the password. Recommended before going live: a stolen password alone then cannot open the admin."
        >
          <ActionForm
            action={setRequireTwoFactorAction}
            submitLabel="Save"
            testId="require-two-factor-form"
          >
            <CheckboxField
              label="Require two-factor sign-in for owners and managers"
              name="require"
              defaultChecked={required}
            />
          </ActionForm>
        </Card>
      ) : null}
    </div>
  );
}
