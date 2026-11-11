import { randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma } from "@ecom/db";
import { CookieJar, totpCode } from "@ecom/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMemoryEmailProvider } from "../notifications/email";
import { createLogger } from "../platform/logger";
import { createMemoryRateLimiter } from "../platform/rate-limit";
import { createAuth } from "./auth";
import { createAuthService } from "./auth-service";
import { seedSystemData } from "./seed";
import { createStaffUser } from "./staff-users";

// Integration test against the real database. Email and rate limiting use
// in-memory implementations so each test controls them.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const run = randomUUID().slice(0, 8);
const logLines: string[] = [];
const logger = createLogger("test", "debug", { write: (line) => void logLines.push(line) });
const email = createMemoryEmailProvider();
const userIds: string[] = [];
let tenantId: string;

function build() {
  const limiter = createMemoryRateLimiter();
  const auth = createAuth({ prisma: admin, env, email, logger });
  return createAuthService({ auth, prisma: admin, limiter, logger });
}

let counter = 0;
async function newUser(options: { withMembership?: boolean } = {}) {
  counter += 1;
  const credentials = {
    email: `auth-${run}-${counter}@example.test`,
    password: `Correct-horse-${run}-${counter}`,
  };
  const user = await createStaffUser(admin, {
    ...credentials,
    name: `Test ${counter}`,
    actor: "test",
    ...(options.withMembership
      ? { membership: { tenantSlug: `auth-${run}`, role: "store_owner" as const } }
      : {}),
  });
  userIds.push(user.id);
  return { ...credentials, id: user.id };
}

const ip = "203.0.113.7";
const request = (jar = new CookieJar()) => ({ headers: jar.headers(), ip });

async function signedIn(service = build()) {
  const user = await newUser();
  const jar = new CookieJar();
  const result = await service.signIn({ ...user, ...request(jar) });
  expect(result.status).toBe("signed_in");
  jar.absorb(result.setCookies);
  return { service, user, jar };
}

const resetTokenFor = (address: string) => {
  const message = email.sent.findLast((m) => m.to === address);
  return message
    ? new URL(/https?:\/\/\S+/.exec(message.text)![0]).searchParams.get("token")!
    : null;
};

beforeAll(async () => {
  await seedSystemData(admin);
  tenantId = (await admin.tenant.create({ data: { name: "Auth test", slug: `auth-${run}` } })).id;
});

afterAll(async () => {
  await admin.userTenantMembership.deleteMany({ where: { tenantId } });
  await admin.tenant.deleteMany({ where: { id: tenantId } });
  await admin.user.deleteMany({ where: { id: { in: userIds } } });
  await disconnectDatabase();
});

describe("sign-in", () => {
  it("accepts the right password and sets a hardened session cookie", async () => {
    const service = build();
    const user = await newUser({ withMembership: true });

    const result = await service.signIn({ ...user, ...request() });

    expect(result.status).toBe("signed_in");
    const cookie = result.setCookies.find((c) => c.startsWith("ecom.session_token="))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);

    const session = await service.getSession(new CookieJar().absorb(result.setCookies).headers());
    expect(session?.user).toMatchObject({
      id: user.id,
      email: user.email,
      twoFactorEnabled: false,
      isPlatformAdmin: false,
    });
    expect(session?.memberships).toEqual([
      expect.objectContaining({ tenantId, roleKey: "store_owner" }),
    ]);
  });

  it("is case-insensitive about the email address", async () => {
    const service = build();
    const user = await newUser();
    const result = await service.signIn({
      email: `  ${user.email.toUpperCase()} `,
      password: user.password,
      ...request(),
    });
    expect(result.status).toBe("signed_in");
  });

  it("gives the same answer for a wrong password and an unknown account", async () => {
    const service = build();
    const user = await newUser();

    const wrong = await service.signIn({
      email: user.email,
      password: "wrong-password",
      ...request(),
    });
    const unknown = await service.signIn({
      email: `nobody-${run}@example.test`,
      password: "wrong-password",
      ...request(),
    });

    expect(wrong).toEqual({ status: "invalid_credentials", setCookies: [] });
    expect(unknown).toEqual(wrong);
  });

  it("stores passwords as Argon2id hashes, never in plain text", async () => {
    const user = await newUser();
    const account = await admin.account.findFirstOrThrow({ where: { userId: user.id } });
    expect(account.password).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(account.password).not.toContain(user.password);
  });

  it("locks the account after five failures, even for the right password", async () => {
    const service = build();
    const user = await newUser();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const result = await service.signIn({ email: user.email, password: "wrong", ...request() });
      expect(result.status).toBe("invalid_credentials");
    }

    const locked = await service.signIn({ ...user, ...request() });

    expect(locked.status).toBe("locked");
    expect(locked.status === "locked" && locked.retryAfterSeconds).toBeGreaterThan(0);
    expect(locked.setCookies).toEqual([]);
  });

  it("does not lock one account because of failures on another", async () => {
    const service = build();
    const [victim, other] = [await newUser(), await newUser()];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await service.signIn({ email: victim.email, password: "wrong", ...request() });
    }
    expect((await service.signIn({ ...other, ...request() })).status).toBe("signed_in");
  });

  it("refuses a disabled user and ends their existing sessions' access", async () => {
    const { service, user, jar } = await signedIn();
    expect(await service.getSession(jar.headers())).not.toBeNull();

    await admin.user.update({ where: { id: user.id }, data: { status: "disabled" } });

    expect(await service.getSession(jar.headers())).toBeNull();
    expect((await service.signIn({ ...user, ...request() })).status).toBe("invalid_credentials");
  });
});

describe("sessions", () => {
  it("returns nothing without a cookie or with a forged one", async () => {
    const service = build();
    expect(await service.getSession(new Headers())).toBeNull();
    expect(
      await service.getSession(new Headers({ cookie: "ecom.session_token=forged.signature" })),
    ).toBeNull();
  });

  it("ends on sign-out; the old cookie stops working", async () => {
    const { service, jar } = await signedIn();
    const before = jar.headers();

    const result = await service.signOut(request(jar));
    jar.absorb(result.setCookies);

    expect(jar.names()).not.toContain("ecom.session_token");
    expect(await service.getSession(before)).toBeNull();
  });

  it("can be ended everywhere at once", async () => {
    const { service, user, jar } = await signedIn();
    const second = new CookieJar().absorb(
      (await service.signIn({ ...user, ...request() })).setCookies,
    );

    await service.signOutEverywhere(request(jar));

    expect(await service.getSession(jar.headers())).toBeNull();
    expect(await service.getSession(second.headers())).toBeNull();
  });
});

describe("password reset", () => {
  it("emails a single-use link, changes the password and ends existing sessions", async () => {
    const { service, user, jar } = await signedIn();

    await service.requestPasswordReset({ email: user.email, ip });
    await expect.poll(() => resetTokenFor(user.email)).toBeTruthy();
    const token = resetTokenFor(user.email)!;
    const newPassword = `New-password-${run}`;

    expect(await service.resetPassword({ token, newPassword, ip })).toEqual({ status: "ok" });

    expect(await service.getSession(jar.headers())).toBeNull();
    expect((await service.signIn({ ...user, ...request() })).status).toBe("invalid_credentials");
    expect(
      (await service.signIn({ email: user.email, password: newPassword, ...request() })).status,
    ).toBe("signed_in");
    // The link cannot be used twice.
    expect(await service.resetPassword({ token, newPassword: `Another-${run}-x`, ip })).toEqual({
      status: "invalid_token",
    });
  });

  it("sends nothing and reveals nothing for an unknown address", async () => {
    const service = build();
    const address = `ghost-${run}@example.test`;
    await expect(service.requestPasswordReset({ email: address, ip })).resolves.toBeUndefined();
    expect(email.sent.filter((m) => m.to === address)).toEqual([]);
  });

  it("rejects made-up tokens and weak passwords", async () => {
    const service = build();
    expect(
      await service.resetPassword({ token: "made-up", newPassword: `Long-enough-${run}`, ip }),
    ).toEqual({ status: "invalid_token" });
    expect(await service.resetPassword({ token: "any", newPassword: "short", ip })).toMatchObject({
      status: "weak_password",
    });
  });

  it("stops sending after three requests for the same address in an hour", async () => {
    const service = build();
    const user = await newUser();
    for (let i = 0; i < 5; i += 1) {
      await service.requestPasswordReset({ email: user.email, ip: `198.51.100.${i}` });
    }
    await expect.poll(() => email.sent.filter((m) => m.to === user.email).length).toBe(3);
  });
});

describe("two-factor authentication", () => {
  it("is enrolled with the password and a code, then required at sign-in", async () => {
    const { service, user, jar } = await signedIn();

    expect(
      await service.beginTwoFactorSetup({ password: "wrong-password", ...request(jar) }),
    ).toEqual({ status: "invalid_password" });

    const setup = await service.beginTwoFactorSetup({ password: user.password, ...request(jar) });
    if (setup.status !== "ok") throw new Error(`setup failed: ${setup.status}`);
    expect(setup.backupCodes.length).toBeGreaterThanOrEqual(5);

    // Not active until a code from the authenticator proves the secret was saved.
    expect((await service.getSession(jar.headers()))?.user.twoFactorEnabled).toBe(false);
    expect((await service.confirmTwoFactorSetup({ code: "000000", ...request(jar) })).ok).toBe(
      false,
    );
    const beforeEnable = jar.headers();
    const confirmed = await service.confirmTwoFactorSetup({
      code: totpCode(setup.secret),
      ...request(jar),
    });
    expect(confirmed.ok).toBe(true);
    // Switching two-factor on replaces the session; the old cookie stops working.
    jar.absorb(confirmed.setCookies);
    expect((await service.getSession(jar.headers()))?.user.twoFactorEnabled).toBe(true);
    expect(await service.getSession(beforeEnable)).toBeNull();

    // Password alone no longer creates a session.
    const pending = new CookieJar();
    const first = await service.signIn({ ...user, ...request() });
    expect(first.status).toBe("two_factor_required");
    pending.absorb(first.setCookies);
    expect(pending.names()).not.toContain("ecom.session_token");
    expect(await service.getSession(pending.headers())).toBeNull();

    const bad = await service.verifySecondFactor({
      code: "000000",
      kind: "totp",
      ...request(pending),
    });
    expect(bad.status).toBe("invalid_code");

    const good = await service.verifySecondFactor({
      code: totpCode(setup.secret),
      kind: "totp",
      ...request(pending),
    });
    expect(good.status).toBe("signed_in");
    pending.absorb(good.setCookies);
    expect((await service.getSession(pending.headers()))?.user.id).toBe(user.id);

    // A backup code works once.
    const backup = setup.backupCodes[0]!;
    const useBackup = async () => {
      const attempt = new CookieJar().absorb(
        (await service.signIn({ ...user, ...request() })).setCookies,
      );
      return service.verifySecondFactor({ code: backup, kind: "backup", ...request(attempt) });
    };
    expect((await useBackup()).status).toBe("signed_in");
    expect((await useBackup()).status).toBe("invalid_code");

    // Turning it off needs the password again.
    expect(
      (await service.disableTwoFactor({ password: "wrong-password", ...request(pending) })).ok,
    ).toBe(false);
    expect(
      (await service.disableTwoFactor({ password: user.password, ...request(pending) })).ok,
    ).toBe(true);
    expect((await service.signIn({ ...user, ...request() })).status).toBe("signed_in");
  });

  it("cannot be verified without first passing the password step", async () => {
    const service = build();
    const result = await service.verifySecondFactor({ code: "123456", kind: "totp", ...request() });
    expect(result.status).toBe("invalid_code");
  });
});

describe("audit trail and logs", () => {
  it("records sign-in, failure and sign-out without any secret", async () => {
    const { service, user, jar } = await signedIn();
    await service.signIn({ email: user.email, password: "wrong-password-xyz", ...request() });
    await service.signOut(request(jar));

    const entries = await admin.auditLog.findMany({
      where: { entityId: user.id },
      orderBy: { createdAt: "asc" },
    });
    expect(entries.map((entry) => entry.action)).toEqual([
      "user.created",
      "auth.sign_in",
      "auth.sign_in_failed",
      "auth.sign_out",
    ]);
    expect(entries.slice(1).every((entry) => entry.ip === ip)).toBe(true);

    const serialized = JSON.stringify(entries) + logLines.join("");
    expect(serialized).not.toContain(user.password);
    expect(serialized).not.toContain("wrong-password-xyz");
  });
});
