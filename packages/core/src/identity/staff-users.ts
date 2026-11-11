import type { AdminPrismaClient } from "@ecom/db";
import { hashPassword, passwordProblem } from "./password";
import type { SystemRoleKey } from "./permissions";

export class StaffUserError extends Error {
  constructor(
    readonly code: "weak_password" | "email_taken" | "tenant_not_found" | "invalid_email",
    message: string,
  ) {
    super(message);
    this.name = "StaffUserError";
  }
}

export interface CreateStaffUserInput {
  email: string;
  name: string;
  password: string;
  isPlatformAdmin?: boolean;
  /** Adds the user to this tenant with the given system role. */
  membership?: { tenantSlug: string; role: SystemRoleKey };
  /** Who did this, for the audit log. */
  actor: "cli" | "seed" | "test";
}

/**
 * Creates a staff user who can sign in with email and password. Platform-level
 * operation: uses the admin connection.
 */
export async function createStaffUser(
  prisma: AdminPrismaClient,
  input: CreateStaffUserInput,
): Promise<{ id: string; email: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new StaffUserError("invalid_email", "That does not look like an email address.");
  }
  const problem = passwordProblem(input.password);
  if (problem) throw new StaffUserError("weak_password", problem);

  const passwordHash = await hashPassword(input.password);

  return prisma.$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email }, select: { id: true } })) {
      throw new StaffUserError("email_taken", "A user with this email already exists.");
    }

    const user = await tx.user.create({
      data: {
        email,
        name: input.name,
        emailVerified: true,
        isPlatformAdmin: input.isPlatformAdmin ?? false,
      },
      select: { id: true, email: true },
    });
    await tx.account.create({
      data: {
        userId: user.id,
        providerId: "credential",
        accountId: user.id,
        password: passwordHash,
      },
    });

    let tenantId: string | null = null;
    if (input.membership) {
      const tenant = await tx.tenant.findUnique({
        where: { slug: input.membership.tenantSlug },
        select: { id: true },
      });
      if (!tenant) {
        throw new StaffUserError(
          "tenant_not_found",
          `No tenant with slug "${input.membership.tenantSlug}".`,
        );
      }
      const role = await tx.role.findFirstOrThrow({
        where: { tenantId: null, key: input.membership.role },
        select: { id: true },
      });
      await tx.userTenantMembership.create({
        data: { userId: user.id, tenantId: tenant.id, roleId: role.id },
      });
      tenantId = tenant.id;
    }

    await tx.auditLog.create({
      data: {
        tenantId,
        actorType: "system",
        action: "user.created",
        entityType: "user",
        entityId: user.id,
        after: {
          via: input.actor,
          isPlatformAdmin: input.isPlatformAdmin ?? false,
          role: input.membership?.role ?? null,
        },
      },
    });

    return user;
  });
}
