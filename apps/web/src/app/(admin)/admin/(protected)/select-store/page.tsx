import { Badge, EmptyState, List, ListItem, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import { getAccessOutcome } from "@/server/access";
import { requireSession } from "@/server/auth";
import { SubmitButton } from "../../_components/form";
import { selectStoreAction } from "./actions";

export const metadata: Metadata = { title: "Choose a store" };

export default async function SelectStorePage() {
  const { memberships } = await requireSession();
  const outcome = await getAccessOutcome();
  const activeTenantId = "context" in outcome ? outcome.context.tenantId : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Choose a store"
        description="You can switch at any time from the top bar."
      />

      {memberships.length === 0 ? (
        <EmptyState title="You are not a member of any store yet" />
      ) : (
        <List>
          {memberships.map((membership) => (
            <ListItem key={membership.tenantId}>
              <div>
                <p className="font-medium">{membership.tenantName}</p>
                <p className="text-sm text-ink-muted">{membership.roleName}</p>
              </div>
              {membership.tenantId === activeTenantId ? (
                <Badge tone="success">Current</Badge>
              ) : (
                <form action={selectStoreAction}>
                  <input type="hidden" name="tenantId" value={membership.tenantId} />
                  <SubmitButton tone="secondary">Work in this store</SubmitButton>
                </form>
              )}
            </ListItem>
          ))}
        </List>
      )}
    </div>
  );
}
