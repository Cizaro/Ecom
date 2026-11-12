import { hasPermission, type PermissionKey } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import { requireTenantContext } from "@/server/access";

export const metadata: Metadata = { title: "Your access" };

// Demonstration of the permission layer until real feature pages exist: each
// row is a capability, shown as available or not for the signed-in role.
const CAPABILITIES: { permission: PermissionKey; label: string; href?: string }[] = [
  { permission: "staff.manage", label: "Manage staff and roles", href: "/admin/team" },
  { permission: "orders.read", label: "View orders" },
  { permission: "orders.refund", label: "Issue refunds" },
  { permission: "catalog.write", label: "Edit products" },
  { permission: "inventory.adjust", label: "Adjust stock" },
  { permission: "customers.export", label: "Export customer data" },
  { permission: "marketing.write", label: "Plan marketing campaigns" },
  { permission: "ads.launch", label: "Launch paid ads" },
  { permission: "giveaways.draw", label: "Run giveaway draws" },
  { permission: "settings.write", label: "Change store settings" },
  { permission: "audit.read", label: "View the audit log" },
];

export default async function AccessPage() {
  const { context } = await requireTenantContext();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Your access</h1>
        <p className="mt-1 text-neutral-600">
          In <span className="font-medium">{context.tenantName}</span> you are{" "}
          <span className="font-medium" data-testid="access-role">
            {context.roleName}
          </span>
          .
        </p>
      </div>

      <ul className="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white">
        {CAPABILITIES.map(({ permission, label, href }) => {
          const allowed = hasPermission(context, permission);
          return (
            <li
              key={permission}
              data-testid={`capability-${permission}`}
              data-allowed={allowed}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <span className={allowed ? "" : "text-neutral-500"}>
                {allowed && href ? (
                  <Link href={href} className="font-medium underline underline-offset-4">
                    {label}
                  </Link>
                ) : (
                  label
                )}
              </span>
              <span
                className={`text-sm font-medium ${allowed ? "text-green-800" : "text-neutral-500"}`}
              >
                {allowed ? "Allowed" : "Not allowed"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
