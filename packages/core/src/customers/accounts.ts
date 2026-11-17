import { createTranslator, DEFAULT_LOCALE, type Locale } from "@ecom/i18n";
import { createHash, randomBytes } from "node:crypto";
import type { AppTransaction } from "@ecom/db";
import { assertPermission, type RequestContext } from "../access/context";
import type { TenantDb } from "../access/tenant-db";
import { hashPassword, passwordProblem, verifyPassword } from "../identity/password";
import type { EmailProvider } from "../notifications/email";
import { recordAudit } from "../platform/audit";
import type { RateLimiter, RateLimitRule } from "../platform/rate-limit";

// Customer accounts for one store. Customers are a different kind of person
// from staff: separate tables, a separate cookie, and nothing here can open
// the admin. Rules this file keeps:
//
// - Nothing tells a stranger whether an email address has an account. Sign-up
//   and "forgot password" answer the same way either way; what differs is the
//   email that is sent to the address itself.
// - A new account can sign in only after the emailed link is opened, which
//   proves the address belongs to the person signing up.
// - Sessions and emailed links are random tokens of which only a hash is
//   stored, each looked up inside the store's tenant only.
// - Sign-in attempts are limited per address and per email.

export const CUSTOMER_SESSION_DAYS = 30;
const VERIFY_HOURS = 24;
const RESET_MINUTES = 60;

const SIGN_IN_PER_EMAIL: RateLimitRule = { limit: 5, windowSeconds: 15 * 60 };
const SIGN_IN_PER_IP: RateLimitRule = { limit: 30, windowSeconds: 15 * 60 };
const SIGN_UP_PER_IP: RateLimitRule = { limit: 10, windowSeconds: 60 * 60 };
const EMAIL_PER_ADDRESS: RateLimitRule = { limit: 3, windowSeconds: 60 * 60 };
const RESET_PER_IP: RateLimitRule = { limit: 10, windowSeconds: 60 * 60 };

export type CustomerErrorCode =
  | "invalid"
  | "rate_limited"
  | "invalid_credentials"
  | "unverified"
  | "invalid_token"
  | "not_found"
  | "too_many";

/** A request refused for a reason the customer can act on. The message is safe to show. */
export class CustomerError extends Error {
  constructor(
    readonly code: CustomerErrorCode,
    message: string,
    /** The form field the problem is about, when there is one. */
    readonly field?: string,
  ) {
    super(message);
    this.name = "CustomerError";
  }
}

export interface CustomerDeps {
  email: EmailProvider;
  limiter: RateLimiter;
  /** The store's own address, for links in emails. Never taken from user input. */
  storeUrl: string;
  storeName: string;
  /** The shop language the shopper is using; emails to them are written in it. */
  locale?: Locale;
}

export interface CustomerRequest {
  ip: string;
}

export interface CustomerProfile {
  id: string;
  email: string;
  name: string;
  phone: string | null;
}

// --- Tokens ------------------------------------------------------------------

const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const newToken = () => randomBytes(32).toString("base64url");
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const isToken = (value: unknown): value is string => typeof value === "string" && TOKEN.test(value);

const later = (milliseconds: number) => new Date(Date.now() + milliseconds);

// --- Input -------------------------------------------------------------------

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

function requireEmail(value: unknown): string {
  const email = normalizeEmail(value);
  if (!email) throw new CustomerError("invalid", "Enter a valid email address.", "email");
  return email;
}

function requirePassword(value: unknown): string {
  if (typeof value !== "string") {
    throw new CustomerError("invalid", "Enter a password.", "password");
  }
  const problem = passwordProblem(value);
  if (problem) throw new CustomerError("invalid", problem, "password");
  return value;
}

function cleanName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (name.length > 200) {
    throw new CustomerError("invalid", "The name is too long (200 characters at most).", "name");
  }
  return name;
}

const PHONE = /^\+?[0-9 ()-]{6,20}$/;

export function cleanPhone(value: unknown): string | null {
  const phone = typeof value === "string" ? value.trim() : "";
  if (phone === "") return null;
  if (!PHONE.test(phone)) {
    throw new CustomerError(
      "invalid",
      "Enter the phone number with digits only, optionally starting with +.",
      "phone",
    );
  }
  return phone;
}

// --- Shared steps ------------------------------------------------------------

const limitKey = (kind: string, tenantId: string, subject: string) =>
  `customer:${kind}:${tenantId}:${subject}`;

async function tooMany(limiter: RateLimiter, key: string, rule: RateLimitRule): Promise<boolean> {
  return (await limiter.hit(key, rule)).count > rule.limit;
}

const TOO_MANY_ATTEMPTS = "Too many attempts. Please wait a while and try again.";

async function createSession(tx: AppTransaction, tenantId: string, customerId: string) {
  const token = newToken();
  await tx.customerSession.create({
    data: {
      tenantId,
      customerId,
      tokenHash: hashToken(token),
      expiresAt: later(CUSTOMER_SESSION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  return token;
}

/** Replaces any earlier unused link of the same kind, so only the newest email works. */
async function issueToken(
  tx: AppTransaction,
  tenantId: string,
  customerId: string,
  purpose: "verify_email" | "reset_password",
): Promise<string> {
  await tx.customerToken.deleteMany({ where: { customerId, purpose, usedAt: null } });
  const token = newToken();
  await tx.customerToken.create({
    data: {
      tenantId,
      customerId,
      purpose,
      tokenHash: hashToken(token),
      expiresAt: later(
        purpose === "verify_email" ? VERIFY_HOURS * 60 * 60 * 1000 : RESET_MINUTES * 60 * 1000,
      ),
    },
  });
  return token;
}

async function useToken(
  tx: AppTransaction,
  token: unknown,
  purpose: "verify_email" | "reset_password",
): Promise<{ customerId: string }> {
  const invalid = new CustomerError(
    "invalid_token",
    "This link is not valid any more. Please ask for a new one.",
  );
  if (!isToken(token)) throw invalid;
  const row = await tx.customerToken.findFirst({
    where: { tokenHash: hashToken(token), purpose, usedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, customerId: true, customer: { select: { status: true } } },
  });
  if (!row || row.customer.status !== "active") throw invalid;
  // Only succeeds once, even if two requests arrive together.
  const used = await tx.customerToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (used.count !== 1) throw invalid;
  return { customerId: row.customerId };
}

const translatorFor = (deps: CustomerDeps) => createTranslator(deps.locale ?? DEFAULT_LOCALE);

const emailBody = (deps: CustomerDeps, lines: string[]) =>
  [...lines, "", `${deps.storeName}`, deps.storeUrl].join("\n");

async function sendVerification(deps: CustomerDeps, email: string, token: string) {
  const t = translatorFor(deps);
  const store = deps.storeName;
  await deps.email.send({
    to: email,
    subject: t("Confirm your email address for {store}", { store }),
    text: emailBody(deps, [
      t("Someone, hopefully you, created an account at {store} with this email address.", {
        store,
      }),
      "",
      t("Open this link to confirm the address and finish creating the account:"),
      `${deps.storeUrl}/account/verify?token=${token}`,
      "",
      t("The link works once and for {hours} hours.", { hours: VERIFY_HOURS }),
      t("If you did not create this account, ignore this email and nothing will happen."),
    ]),
  });
}

// --- Sign up -----------------------------------------------------------------

export interface SignUpInput {
  email: unknown;
  password: unknown;
  name?: unknown;
  /** Whether the "send me news and offers" box was ticked. */
  marketingConsent?: boolean;
}

/**
 * Starts an account. Always ends the same way for the caller ("check your
 * email"), whether or not the address already has an account; the email sent
 * is what differs.
 */
export async function signUp(
  db: TenantDb,
  deps: CustomerDeps,
  request: CustomerRequest,
  input: SignUpInput,
): Promise<void> {
  const email = requireEmail(input.email);
  const password = requirePassword(input.password);
  const name = cleanName(input.name);
  if (await tooMany(deps.limiter, limitKey("sign-up", db.tenantId, request.ip), SIGN_UP_PER_IP)) {
    throw new CustomerError("rate_limited", TOO_MANY_ATTEMPTS);
  }
  // Hashed before looking anything up, so the reply takes as long either way.
  const passwordHash = await hashPassword(password);
  const mayEmail = !(await tooMany(
    deps.limiter,
    limitKey("email", db.tenantId, email),
    EMAIL_PER_ADDRESS,
  ));

  const outcome = await db.run(async (tx) => {
    const existing = await tx.customer.findUnique({
      where: { tenantId_email: { tenantId: db.tenantId, email } },
      select: { id: true, emailVerifiedAt: true, passwordHash: true, status: true },
    });
    if (existing && existing.emailVerifiedAt && existing.passwordHash) {
      return { kind: "exists" as const };
    }
    if (existing && existing.status !== "active") return { kind: "blocked" as const };

    // New, or started but never confirmed: the newest sign-up is the one that counts.
    const customer = existing
      ? await tx.customer.update({
          where: { id: existing.id },
          data: { passwordHash, ...(name ? { name } : {}) },
          select: { id: true },
        })
      : await tx.customer.create({
          data: { tenantId: db.tenantId, email, name, passwordHash },
          select: { id: true },
        });
    await tx.consentRecord.create({
      data: {
        tenantId: db.tenantId,
        subjectType: "customer",
        subjectId: customer.id,
        purpose: "marketing_email",
        granted: input.marketingConsent === true,
        source: "sign_up",
      },
    });
    await recordAudit(tx, {
      tenantId: db.tenantId,
      actorType: "customer",
      actorUserId: null,
      action: "customer.sign_up",
      entityType: "customer",
      entityId: customer.id,
      ip: request.ip,
    });
    return {
      kind: "created" as const,
      token: await issueToken(tx, db.tenantId, customer.id, "verify_email"),
    };
  });

  if (!mayEmail) return;
  if (outcome.kind === "created") {
    await sendVerification(deps, email, outcome.token);
  } else if (outcome.kind === "exists") {
    const t = translatorFor(deps);
    const store = deps.storeName;
    await deps.email.send({
      to: email,
      subject: t("You already have an account at {store}", { store }),
      text: emailBody(deps, [
        t(
          "Someone, hopefully you, tried to create an account at {store} with this email address, but it already has one.",
          { store },
        ),
        "",
        t("Sign in here: {url}", { url: `${deps.storeUrl}/account/sign-in` }),
        t("Forgotten the password? {url}", { url: `${deps.storeUrl}/account/forgot-password` }),
        "",
        t("If this was not you, you can ignore this email. Your account has not been changed."),
      ]),
    });
  }
}

/** Confirms an email address from the emailed link and signs the customer in. */
export async function verifyEmail(
  db: TenantDb,
  request: CustomerRequest,
  token: unknown,
): Promise<{ sessionToken: string; customerId: string }> {
  return db.run(async (tx) => {
    const { customerId } = await useToken(tx, token, "verify_email");
    await tx.customer.update({
      where: { id: customerId },
      data: { emailVerifiedAt: new Date() },
    });
    await recordAudit(tx, {
      tenantId: db.tenantId,
      actorType: "customer",
      actorUserId: null,
      action: "customer.email_verified",
      entityType: "customer",
      entityId: customerId,
      ip: request.ip,
    });
    return { sessionToken: await createSession(tx, db.tenantId, customerId), customerId };
  });
}

// --- Sign in and out ---------------------------------------------------------

/** A real hash of a password nobody has, so a wrong email costs the same time as a wrong password. */
let dummyHash: Promise<string> | undefined;

const WRONG = "The email address or password is not right.";

export async function signIn(
  db: TenantDb,
  deps: CustomerDeps,
  request: CustomerRequest,
  input: { email: unknown; password: unknown },
): Promise<{ sessionToken: string; customerId: string }> {
  const email = normalizeEmail(input.email);
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || password === "") throw new CustomerError("invalid_credentials", WRONG);

  const perEmail = limitKey("sign-in", db.tenantId, email);
  const perIp = limitKey("sign-in-ip", db.tenantId, request.ip);
  const [emailStatus, ipStatus] = await Promise.all([
    deps.limiter.check(perEmail, SIGN_IN_PER_EMAIL),
    deps.limiter.check(perIp, SIGN_IN_PER_IP),
  ]);
  if (emailStatus.blocked || ipStatus.blocked) {
    throw new CustomerError("rate_limited", TOO_MANY_ATTEMPTS);
  }

  const customer = await db.run((tx) =>
    tx.customer.findUnique({
      where: { tenantId_email: { tenantId: db.tenantId, email } },
      select: { id: true, passwordHash: true, emailVerifiedAt: true, status: true },
    }),
  );
  dummyHash ??= hashPassword(randomBytes(24).toString("base64url"));
  const matches = await verifyPassword(customer?.passwordHash ?? (await dummyHash), password);

  if (!customer || !customer.passwordHash || !matches || customer.status !== "active") {
    await Promise.all([
      deps.limiter.hit(perEmail, SIGN_IN_PER_EMAIL),
      deps.limiter.hit(perIp, SIGN_IN_PER_IP),
    ]);
    await db.run((tx) =>
      recordAudit(tx, {
        tenantId: db.tenantId,
        actorType: "anonymous",
        actorUserId: null,
        action: "customer.sign_in_failed",
        entityType: "customer",
        entityId: customer?.id ?? null,
        ip: request.ip,
      }),
    );
    throw new CustomerError("invalid_credentials", WRONG);
  }

  if (!customer.emailVerifiedAt) {
    // Only someone who knows the password gets this far, so saying so leaks nothing.
    if (!(await tooMany(deps.limiter, limitKey("email", db.tenantId, email), EMAIL_PER_ADDRESS))) {
      const token = await db.run((tx) => issueToken(tx, db.tenantId, customer.id, "verify_email"));
      await sendVerification(deps, email, token);
    }
    throw new CustomerError(
      "unverified",
      "Please confirm your email address first. We have sent you the link again.",
    );
  }

  await deps.limiter.reset(perEmail);
  return db.run(async (tx) => {
    await recordAudit(tx, {
      tenantId: db.tenantId,
      actorType: "customer",
      actorUserId: null,
      action: "customer.sign_in",
      entityType: "customer",
      entityId: customer.id,
      ip: request.ip,
    });
    return {
      sessionToken: await createSession(tx, db.tenantId, customer.id),
      customerId: customer.id,
    };
  });
}

/** The customer this session cookie belongs to, or null. Checked on every request. */
export async function getSessionCustomer(
  db: TenantDb,
  sessionToken: unknown,
): Promise<CustomerProfile | null> {
  if (!isToken(sessionToken)) return null;
  const session = await db.run((tx) =>
    tx.customerSession.findFirst({
      where: { tokenHash: hashToken(sessionToken), expiresAt: { gt: new Date() } },
      select: {
        customer: {
          select: { id: true, email: true, name: true, phone: true, status: true },
        },
      },
    }),
  );
  if (!session || session.customer.status !== "active") return null;
  const { status: _status, ...profile } = session.customer;
  return profile;
}

export async function signOut(db: TenantDb, sessionToken: unknown): Promise<void> {
  if (!isToken(sessionToken)) return;
  await db.run((tx) =>
    tx.customerSession.deleteMany({ where: { tokenHash: hashToken(sessionToken) } }),
  );
}

// --- Password reset ----------------------------------------------------------

/** Emails a reset link if the address has an account. Says nothing either way. */
export async function requestPasswordReset(
  db: TenantDb,
  deps: CustomerDeps,
  request: CustomerRequest,
  emailInput: unknown,
): Promise<void> {
  if (await tooMany(deps.limiter, limitKey("reset-ip", db.tenantId, request.ip), RESET_PER_IP)) {
    throw new CustomerError("rate_limited", TOO_MANY_ATTEMPTS);
  }
  const email = normalizeEmail(emailInput);
  if (!email) return;
  if (await tooMany(deps.limiter, limitKey("email", db.tenantId, email), EMAIL_PER_ADDRESS)) {
    return;
  }
  const token = await db.run(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { tenantId_email: { tenantId: db.tenantId, email } },
      select: { id: true, status: true },
    });
    if (!customer || customer.status !== "active") return null;
    return issueToken(tx, db.tenantId, customer.id, "reset_password");
  });
  if (!token) return;
  const t = translatorFor(deps);
  const store = deps.storeName;
  await deps.email.send({
    to: email,
    subject: t("Choose a new password for {store}", { store }),
    text: emailBody(deps, [
      t("Someone, hopefully you, asked to choose a new password for your account at {store}.", {
        store,
      }),
      "",
      t("Open this link to choose one:"),
      `${deps.storeUrl}/account/reset-password?token=${token}`,
      "",
      t("The link works once and for {minutes} minutes.", { minutes: RESET_MINUTES }),
      t("If this was not you, ignore this email. Your password has not been changed."),
    ]),
  });
}

/**
 * Sets a new password from the emailed link and signs the customer out
 * everywhere. Opening the link also proves the address, so it counts as
 * confirming it.
 */
export async function resetPassword(
  db: TenantDb,
  request: CustomerRequest,
  token: unknown,
  newPassword: unknown,
): Promise<void> {
  const password = requirePassword(newPassword);
  const passwordHash = await hashPassword(password);
  await db.run(async (tx) => {
    const { customerId } = await useToken(tx, token, "reset_password");
    const customer = await tx.customer.findUniqueOrThrow({
      where: { id: customerId },
      select: { emailVerifiedAt: true },
    });
    await tx.customer.update({
      where: { id: customerId },
      data: { passwordHash, emailVerifiedAt: customer.emailVerifiedAt ?? new Date() },
    });
    await tx.customerSession.deleteMany({ where: { customerId } });
    await tx.customerToken.deleteMany({ where: { customerId, usedAt: null } });
    await recordAudit(tx, {
      tenantId: db.tenantId,
      actorType: "customer",
      actorUserId: null,
      action: "customer.password_reset",
      entityType: "customer",
      entityId: customerId,
      ip: request.ip,
    });
  });
}

// --- Profile and consent -----------------------------------------------------

export async function updateProfile(
  db: TenantDb,
  customerId: string,
  input: { name: unknown; phone: unknown },
): Promise<void> {
  const data = { name: cleanName(input.name), phone: cleanPhone(input.phone) };
  await db.run((tx) => tx.customer.update({ where: { id: customerId }, data }));
}

/** Whether the customer currently agrees to marketing email: their most recent decision. */
export async function getMarketingConsent(db: TenantDb, customerId: string): Promise<boolean> {
  const latest = await db.run((tx) =>
    tx.consentRecord.findFirst({
      where: { subjectType: "customer", subjectId: customerId, purpose: "marketing_email" },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: { granted: true },
    }),
  );
  return latest?.granted ?? false;
}

/** Records a decision. Earlier decisions are kept: the history is the proof of consent. */
export async function setMarketingConsent(
  db: TenantDb,
  customerId: string,
  granted: boolean,
  source: string,
): Promise<void> {
  if ((await getMarketingConsent(db, customerId)) === granted) return;
  await db.run((tx) =>
    tx.consentRecord.create({
      data: {
        tenantId: db.tenantId,
        subjectType: "customer",
        subjectId: customerId,
        purpose: "marketing_email",
        granted,
        source,
      },
    }),
  );
}

// --- For staff ---------------------------------------------------------------

export const CUSTOMER_PAGE_SIZE = 25;

export interface CustomerSummary {
  id: string;
  email: string;
  name: string;
  emailVerified: boolean;
  hasAccount: boolean;
  status: "active" | "disabled";
  createdAt: Date;
}

export interface CustomerList {
  items: CustomerSummary[];
  total: number;
  page: number;
  pageCount: number;
}

/** Customers of the tenant, newest first. Never includes password hashes. */
export async function listCustomers(
  db: TenantDb,
  context: RequestContext,
  input: { search?: string; page?: number } = {},
): Promise<CustomerList> {
  assertPermission(context, "customers.read");
  const search = (input.search ?? "").trim().slice(0, 100);
  const page = Number.isInteger(input.page) ? Math.min(10_000, Math.max(1, input.page!)) : 1;
  const where = search
    ? {
        OR: [
          { email: { contains: search.toLowerCase() } },
          { name: { contains: search, mode: "insensitive" as const } },
        ],
      }
    : {};
  const { rows, total } = await db.run(async (tx) => ({
    total: await tx.customer.count({ where }),
    rows: await tx.customer.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        emailVerifiedAt: true,
        passwordHash: true,
        status: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * CUSTOMER_PAGE_SIZE,
      take: CUSTOMER_PAGE_SIZE,
    }),
  }));
  return {
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)),
    items: rows.map((row) => ({
      id: row.id,
      email: row.email,
      name: row.name,
      emailVerified: row.emailVerifiedAt !== null,
      hasAccount: row.passwordHash !== null,
      status: row.status,
      createdAt: row.createdAt,
    })),
  };
}
