import { apiRoute } from "@/server/api";

// The signed-in staff user, their working tenant, role and permissions.
export const GET = apiRoute({ access: { level: "tenant" } }, async ({ session, context }) => {
  return {
    user: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      twoFactorEnabled: session.user.twoFactorEnabled,
    },
    tenant: { id: context.tenantId, slug: context.tenantSlug, name: context.tenantName },
    storeId: context.storeId,
    role: { key: context.roleKey, name: context.roleName },
    permissions: [...context.permissions].sort(),
  };
});
