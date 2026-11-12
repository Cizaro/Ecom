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
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Choose a store</h1>
        <p className="mt-1 text-neutral-600">You can switch at any time from the top bar.</p>
      </div>

      {memberships.length === 0 ? (
        <p className="text-sm text-neutral-600">You are not a member of any store yet.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {memberships.map((membership) => (
            <li
              key={membership.tenantId}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white p-4"
            >
              <div>
                <p className="font-medium">{membership.tenantName}</p>
                <p className="text-sm text-neutral-600">{membership.roleName}</p>
              </div>
              {membership.tenantId === activeTenantId ? (
                <span className="text-sm font-medium text-green-800">Current</span>
              ) : (
                <form action={selectStoreAction}>
                  <input type="hidden" name="tenantId" value={membership.tenantId} />
                  <SubmitButton tone="quiet">Work in this store</SubmitButton>
                </form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
