import { listTeamMembers } from "@ecom/core";
import type { Metadata } from "next";
import { requirePermission, tenantDb } from "@/server/access";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const { context } = await requirePermission("staff.manage");
  const members = await listTeamMembers(tenantDb(context));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Team</h1>
        <p className="mt-1 text-neutral-600">
          Staff of {context.tenantName}. Inviting and editing staff comes with store settings.
        </p>
      </div>

      <ul
        className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white"
        data-testid="team-list"
      >
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
          >
            <div className="min-w-0">
              <p className="truncate font-medium">{member.name || member.email}</p>
              <p className="truncate text-sm text-neutral-600" data-testid="team-member-email">
                {member.email}
              </p>
            </div>
            <div className="text-right text-sm text-neutral-600">
              <p>{member.roleName}</p>
              <p>
                {member.status === "active" ? "" : `${member.status} · `}
                Two-factor {member.twoFactorEnabled ? "on" : "off"}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
