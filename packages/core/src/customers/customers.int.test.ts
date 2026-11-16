import { createHash, randomUUID } from "node:crypto";
import { getEnv } from "@ecom/config";
import { disconnectDatabase, getAdminPrisma, getAppPrisma, withTenant } from "@ecom/db";
import { fieldsAndNumbers } from "@ecom/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ForbiddenError, type RequestContext } from "../access/context";
import { createTenantDb, type TenantDb } from "../access/tenant-db";
import { addToCart, claimCartForCustomer, getCart, MAX_LINE_QUANTITY } from "../cart/cart";
import { SYSTEM_ROLES, type PermissionKey, type SystemRoleKey } from "../identity/permissions";
import { createMemoryEmailProvider } from "../notifications/email";
import { createMemoryRateLimiter } from "../platform/rate-limit";
import {
  CustomerError,
  getMarketingConsent,
  getSessionCustomer,
  listCustomers,
  requestPasswordReset,
  resetPassword,
  setMarketingConsent,
  signIn,
  signOut,
  signUp,
  updateProfile,
  verifyEmail,
  type CustomerDeps,
  type CustomerErrorCode,
} from "./accounts";
import {
  createAddress,
  deleteAddress,
  getAddress,
  listAddresses,
  MAX_ADDRESSES,
  setDefaultAddress,
  updateAddress,
} from "./addresses";

// Customer accounts, addresses and cart ownership against the real (test)
// database on the runtime connection, so Row-Level Security is in force.
// Email goes to an in-memory outbox and rate limits to an in-memory counter.

const env = getEnv();
const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const app = getAppPrisma(env.DATABASE_URL);
const run = randomUUID().slice(0, 8);
const tenantIds: string[] = [];
const PASSWORD = "correct horse battery";
const request = { ip: "203.0.113.40" };

let shopA: TenantDb;
let shopB: TenantDb;
let tenantA: string;
let tenantB: string;
let outbox: ReturnType<typeof createMemoryEmailProvider>;
let deps: CustomerDeps;

async function createTenant(label: string) {
  const tenant = await admin.tenant.create({
    data: { name: `Customers ${label} ${run}`, slug: `customers-${label}-${run}` },
  });
  await admin.store.create({ data: { tenantId: tenant.id, name: `Store ${label}`, slug: "main" } });
  tenantIds.push(tenant.id);
  return tenant.id;
}

const uniqueEmail = (label = "shopper") => `${label}-${randomUUID().slice(0, 8)}@example.test`;

async function expectError(work: Promise<unknown>, code: CustomerErrorCode) {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error, `expected CustomerError ${code}`).toBeInstanceOf(CustomerError);
  expect((error as CustomerError).code).toBe(code);
}

/** The token in the newest email to this address. */
function tokenFor(email: string): string {
  const message = [...outbox.sent].reverse().find((candidate) => candidate.to === email);
  const token = /token=([A-Za-z0-9_-]{43})/.exec(message?.text ?? "")?.[1];
  if (!token) throw new Error(`no token emailed to ${email}`);
  return token;
}

/** A confirmed, signed-in customer. */
async function newCustomer(db: TenantDb = shopA, email = uniqueEmail()) {
  await signUp(db, deps, request, { email, password: PASSWORD, name: "Sam Shopper" });
  const { sessionToken, customerId } = await verifyEmail(db, request, tokenFor(email));
  return { email, sessionToken, customerId };
}

const address = (extra: Record<string, unknown> = {}) => ({
  fullName: "Sam Shopper",
  line1: "1 High Street",
  city: "Cairo",
  country: "EG",
  ...extra,
});

beforeAll(async () => {
  tenantA = await createTenant("a");
  tenantB = await createTenant("b");
  shopA = createTenantDb(app, { tenantId: tenantA });
  shopB = createTenantDb(app, { tenantId: tenantB });
});

beforeEach(() => {
  outbox = createMemoryEmailProvider();
  deps = {
    email: outbox,
    limiter: createMemoryRateLimiter(),
    storeUrl: "https://shop.example.test",
    storeName: "Test Shop",
  };
});

afterAll(async () => {
  await admin.tenant.deleteMany({ where: { id: { in: tenantIds } } });
  await disconnectDatabase();
});

describe("signing up", () => {
  it("creates an unconfirmed account, emails a link, and signs in once it is opened", async () => {
    const email = uniqueEmail();
    await signUp(shopA, deps, request, {
      email: `  ${email.toUpperCase()} `,
      password: PASSWORD,
      name: " Sam Shopper ",
      marketingConsent: true,
    });

    const row = await admin.customer.findFirstOrThrow({ where: { tenantId: tenantA, email } });
    expect(row).toMatchObject({ name: "Sam Shopper", emailVerifiedAt: null, status: "active" });
    expect(row.passwordHash).toMatch(/^\$argon2id\$/);
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]).toMatchObject({ to: email });
    expect(outbox.sent[0]!.text).toContain("https://shop.example.test/account/verify?token=");

    // The password alone is not enough until the address is confirmed.
    await expectError(signIn(shopA, deps, request, { email, password: PASSWORD }), "unverified");

    const token = tokenFor(email);
    const { sessionToken, customerId } = await verifyEmail(shopA, request, token);
    expect(customerId).toBe(row.id);
    expect(await getSessionCustomer(shopA, sessionToken)).toMatchObject({
      id: row.id,
      email,
      name: "Sam Shopper",
    });
    // The link works once.
    await expectError(verifyEmail(shopA, request, token), "invalid_token");

    // Only hashes of the link and of the session are stored.
    const stored = JSON.stringify([
      await admin.customerToken.findMany({ where: { customerId } }),
      await admin.customerSession.findMany({ where: { customerId } }),
    ]);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(sessionToken);
    expect(stored).toContain(createHash("sha256").update(sessionToken).digest("hex"));

    expect(await getMarketingConsent(shopA, customerId)).toBe(true);
  });

  it("answers the same way for an address that already has an account", async () => {
    const { email, customerId } = await newCustomer();
    const before = await admin.customer.findUniqueOrThrow({ where: { id: customerId } });
    outbox.sent.length = 0;

    // No error, no different result: the caller cannot tell.
    await expect(
      signUp(shopA, deps, request, { email, password: "another password 1" }),
    ).resolves.toBeUndefined();

    // The owner of the address is told, and nothing about the account changed.
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]!.subject).toContain("already have an account");
    expect(outbox.sent[0]!.text).not.toContain("token=");
    const after = await admin.customer.findUniqueOrThrow({ where: { id: customerId } });
    expect(after.passwordHash).toBe(before.passwordHash);
    await expectError(
      signIn(shopA, deps, request, { email, password: "another password 1" }),
      "invalid_credentials",
    );
  });

  it("lets the newest sign-up win while the address is unconfirmed", async () => {
    const email = uniqueEmail();
    await signUp(shopA, deps, request, { email, password: "first password 123" });
    const firstLink = tokenFor(email);
    await signUp(shopA, deps, request, { email, password: PASSWORD });
    await expectError(verifyEmail(shopA, request, firstLink), "invalid_token");
    await verifyEmail(shopA, request, tokenFor(email));
    await expectError(
      signIn(shopA, deps, request, { email, password: "first password 123" }),
      "invalid_credentials",
    );
    await signIn(shopA, deps, request, { email, password: PASSWORD });
    expect(await admin.customer.count({ where: { tenantId: tenantA, email } })).toBe(1);
  });

  it("refuses bad input before doing anything", async () => {
    const before = await admin.customer.count({ where: { tenantId: tenantA } });
    for (const email of [
      "",
      "not-an-email",
      "a@b",
      "two@@example.test",
      "x".repeat(260) + "@e.co",
    ]) {
      await expectError(signUp(shopA, deps, request, { email, password: PASSWORD }), "invalid");
    }
    for (const password of ["", "short", "x".repeat(200), 12345678901 as never]) {
      await expectError(
        signUp(shopA, deps, request, { email: uniqueEmail(), password }),
        "invalid",
      );
    }
    await expectError(
      signUp(shopA, deps, request, {
        email: uniqueEmail(),
        password: PASSWORD,
        name: "n".repeat(201),
      }),
      "invalid",
    );
    expect(await admin.customer.count({ where: { tenantId: tenantA } })).toBe(before);
    expect(outbox.sent).toEqual([]);
  });

  it("limits sign-ups from one address and emails to one mailbox", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await signUp(shopA, deps, request, { email: uniqueEmail(), password: PASSWORD });
    }
    await expectError(
      signUp(shopA, deps, request, { email: uniqueEmail(), password: PASSWORD }),
      "rate_limited",
    );

    // A fresh visitor hammering one mailbox: the mailbox gets three emails an hour.
    const victim = uniqueEmail("victim");
    for (let attempt = 0; attempt < 6; attempt += 1) {
      await signUp(
        shopA,
        deps,
        { ip: `198.51.100.${attempt}` },
        { email: victim, password: PASSWORD },
      );
    }
    expect(outbox.sent.filter((message) => message.to === victim)).toHaveLength(3);
  });
});

describe("signing in and out", () => {
  it("accepts the right password, whatever the letter case of the email", async () => {
    const { email, customerId } = await newCustomer();
    const { sessionToken } = await signIn(shopA, deps, request, {
      email: email.toUpperCase(),
      password: PASSWORD,
    });
    expect((await getSessionCustomer(shopA, sessionToken))?.id).toBe(customerId);
    await signOut(shopA, sessionToken);
    expect(await getSessionCustomer(shopA, sessionToken)).toBeNull();
  });

  it("gives one answer for every kind of wrong", async () => {
    const { email } = await newCustomer();
    const attempts = [
      { email, password: "wrong password 1" },
      { email: uniqueEmail("nobody"), password: PASSWORD },
      { email: "not-an-email", password: PASSWORD },
      { email, password: "" },
      { email: null as never, password: null as never },
    ];
    const messages = new Set<string>();
    for (const attempt of attempts) {
      const error = await signIn(shopA, deps, request, attempt).catch((reason: unknown) => reason);
      expect(error).toBeInstanceOf(CustomerError);
      expect((error as CustomerError).code).toBe("invalid_credentials");
      messages.add((error as CustomerError).message);
    }
    expect(messages.size).toBe(1);
  });

  it("locks out after repeated wrong passwords, even with the right one", async () => {
    const { email } = await newCustomer();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await expectError(
        signIn(shopA, deps, request, { email, password: "wrong password 1" }),
        "invalid_credentials",
      );
    }
    await expectError(signIn(shopA, deps, request, { email, password: PASSWORD }), "rate_limited");
    // Another customer at the same address is not locked out by it.
    const other = await newCustomer();
    await signIn(shopA, deps, request, { email: other.email, password: PASSWORD });
  });

  it("refuses a disabled customer and ends their sessions' use", async () => {
    const { email, sessionToken, customerId } = await newCustomer();
    await admin.customer.update({ where: { id: customerId }, data: { status: "disabled" } });
    expect(await getSessionCustomer(shopA, sessionToken)).toBeNull();
    await expectError(
      signIn(shopA, deps, request, { email, password: PASSWORD }),
      "invalid_credentials",
    );
  });

  it("ignores malformed, expired and foreign session tokens", async () => {
    const { sessionToken, customerId } = await newCustomer();
    const hash = createHash("sha256").update(sessionToken).digest("hex");
    for (const token of [null, undefined, "", "abc", hash, `${sessionToken}x`, 42, {}]) {
      expect(await getSessionCustomer(shopA, token)).toBeNull();
    }
    await admin.customerSession.updateMany({
      where: { customerId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect(await getSessionCustomer(shopA, sessionToken)).toBeNull();
  });
});

describe("one store's customers are nothing to another store", () => {
  it("keeps the same email address as two separate customers", async () => {
    const email = uniqueEmail("both");
    const inA = await newCustomer(shopA, email);
    // Store B has never heard of this address: a new, separate account.
    await expectError(
      signIn(shopB, deps, request, { email, password: PASSWORD }),
      "invalid_credentials",
    );
    await signUp(shopB, deps, request, { email, password: "store b password 1" });
    const inB = await verifyEmail(shopB, request, tokenFor(email));
    expect(inB.customerId).not.toBe(inA.customerId);

    // Each password and each session works in its own store only.
    await expectError(
      signIn(shopA, deps, request, { email, password: "store b password 1" }),
      "invalid_credentials",
    );
    expect(await getSessionCustomer(shopB, inA.sessionToken)).toBeNull();
    expect(await getSessionCustomer(shopA, inB.sessionToken)).toBeNull();
    expect((await getSessionCustomer(shopA, inA.sessionToken))?.id).toBe(inA.customerId);
  });

  it("does not accept another store's emailed links", async () => {
    const email = uniqueEmail();
    await signUp(shopA, deps, request, { email, password: PASSWORD });
    await expectError(verifyEmail(shopB, request, tokenFor(email)), "invalid_token");
    await verifyEmail(shopA, request, tokenFor(email));

    await requestPasswordReset(shopA, deps, request, email);
    await expectError(
      resetPassword(shopB, request, tokenFor(email), "new password 12345"),
      "invalid_token",
    );
  });

  it("is enforced by the database underneath the services", async () => {
    const { customerId } = await newCustomer();
    await createAddress(shopA, customerId, address());
    const asOther = { tenantId: tenantB };
    // Store B has customers of its own (earlier tests); none of store A's rows are visible to it.
    const seen = await withTenant(app, asOther, async (tx) => ({
      customer: await tx.customer.count({ where: { id: customerId } }),
      session: await tx.customerSession.count({ where: { customerId } }),
      token: await tx.customerToken.count({ where: { customerId } }),
      address: await tx.address.count({ where: { customerId } }),
    }));
    expect(seen).toEqual({ customer: 0, session: 0, token: 0, address: 0 });
    // The same lookups from store A prove the rows exist.
    const own = await withTenant(app, { tenantId: tenantA }, async (tx) => ({
      customer: await tx.customer.count({ where: { id: customerId } }),
      address: await tx.address.count({ where: { customerId } }),
    }));
    expect(own).toEqual({ customer: 1, address: 1 });
    // Store B cannot attach a session or an address to store A's customer.
    await expect(
      withTenant(app, asOther, (tx) =>
        tx.customerSession.create({
          data: {
            tenantId: tenantB,
            customerId,
            tokenHash: "a".repeat(64),
            expiresAt: new Date(Date.now() + 60_000),
          },
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withTenant(app, asOther, (tx) =>
        tx.address.create({
          data: { tenantId: tenantB, customerId, ...address(), fullName: "x" } as never,
        }),
      ),
    ).rejects.toThrow();
  });
});

describe("forgotten password", () => {
  it("emails a single-use link, sets the new password and signs out everywhere", async () => {
    const { email, sessionToken } = await newCustomer();
    outbox.sent.length = 0;
    await requestPasswordReset(shopA, deps, request, email);
    expect(outbox.sent).toHaveLength(1);
    expect(outbox.sent[0]!.text).toContain("/account/reset-password?token=");
    const token = tokenFor(email);

    await expectError(resetPassword(shopA, request, token, "short"), "invalid");
    await resetPassword(shopA, request, token, "a brand new password");
    await expectError(
      resetPassword(shopA, request, token, "yet another password"),
      "invalid_token",
    );

    expect(await getSessionCustomer(shopA, sessionToken)).toBeNull();
    await expectError(
      signIn(shopA, deps, request, { email, password: PASSWORD }),
      "invalid_credentials",
    );
    await signIn(shopA, deps, request, { email, password: "a brand new password" });
  });

  it("says nothing about whether the address has an account", async () => {
    await expect(
      requestPasswordReset(shopA, deps, request, uniqueEmail("nobody")),
    ).resolves.toBeUndefined();
    await expect(
      requestPasswordReset(shopA, deps, request, "not-an-email"),
    ).resolves.toBeUndefined();
    expect(outbox.sent).toEqual([]);
  });

  it("confirms the address of an account that was never confirmed", async () => {
    const email = uniqueEmail();
    await signUp(shopA, deps, request, { email, password: "forgotten password 1" });
    await requestPasswordReset(shopA, deps, request, email);
    await resetPassword(shopA, request, tokenFor(email), PASSWORD);
    await signIn(shopA, deps, request, { email, password: PASSWORD });
  });

  it("rejects expired and made-up links", async () => {
    const { email, customerId } = await newCustomer();
    await requestPasswordReset(shopA, deps, request, email);
    const token = tokenFor(email);
    await admin.customerToken.updateMany({
      where: { customerId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expectError(resetPassword(shopA, request, token, "new password 12345"), "invalid_token");
    for (const made of ["", "x".repeat(43), null, "' OR 1=1 --"]) {
      await expectError(resetPassword(shopA, request, made, "new password 12345"), "invalid_token");
    }
  });
});

describe("profile and marketing consent", () => {
  it("updates name and phone, refusing a phone that is not one", async () => {
    const { customerId, sessionToken } = await newCustomer();
    await updateProfile(shopA, customerId, { name: "Sam S.", phone: "+20 100 123 4567" });
    expect(await getSessionCustomer(shopA, sessionToken)).toMatchObject({
      name: "Sam S.",
      phone: "+20 100 123 4567",
    });
    await expectError(
      updateProfile(shopA, customerId, { name: "Sam", phone: "call me" }),
      "invalid",
    );
    await updateProfile(shopA, customerId, { name: "Sam", phone: "" });
    expect((await getSessionCustomer(shopA, sessionToken))?.phone).toBeNull();
  });

  it("keeps every consent decision as its own record", async () => {
    const { customerId } = await newCustomer();
    expect(await getMarketingConsent(shopA, customerId)).toBe(false);
    await setMarketingConsent(shopA, customerId, true, "account_page");
    await setMarketingConsent(shopA, customerId, true, "account_page"); // no change, no record
    await setMarketingConsent(shopA, customerId, false, "account_page");
    expect(await getMarketingConsent(shopA, customerId)).toBe(false);
    const records = await admin.consentRecord.findMany({
      where: { subjectId: customerId },
      orderBy: { recordedAt: "asc" },
    });
    expect(records.map((record) => [record.granted, record.source])).toEqual([
      [false, "sign_up"],
      [true, "account_page"],
      [false, "account_page"],
    ]);
  });
});

describe("saved addresses", () => {
  it("makes the first address the default and lists defaults first", async () => {
    const { customerId } = await newCustomer();
    const first = await createAddress(shopA, customerId, address());
    const second = await createAddress(shopA, customerId, address({ line1: "2 Side Road" }));
    let list = await listAddresses(shopA, customerId);
    expect(list.map((item) => [item.id, item.isDefaultShipping, item.isDefaultBilling])).toEqual([
      [first.id, true, true],
      [second.id, false, false],
    ]);

    await setDefaultAddress(shopA, customerId, second.id, "shipping");
    list = await listAddresses(shopA, customerId);
    expect(list.find((item) => item.id === second.id)).toMatchObject({
      isDefaultShipping: true,
      isDefaultBilling: false,
    });
    expect(list.find((item) => item.id === first.id)).toMatchObject({
      isDefaultShipping: false,
      isDefaultBilling: true,
    });

    // Removing a default hands it to another address.
    await deleteAddress(shopA, customerId, second.id);
    list = await listAddresses(shopA, customerId);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      id: first.id,
      isDefaultShipping: true,
      isDefaultBilling: true,
    });
  });

  it("applies each country's rules", async () => {
    const { customerId } = await newCustomer();
    // United States: state and a five-digit ZIP code are required.
    await expectError(
      createAddress(shopA, customerId, address({ country: "US", city: "Austin" })),
      "invalid",
    );
    await expectError(
      createAddress(
        shopA,
        customerId,
        address({ country: "US", city: "Austin", region: "TX", postalCode: "ABCDE" }),
      ),
      "invalid",
    );
    const us = await createAddress(
      shopA,
      customerId,
      address({ country: "us", city: "Austin", region: "TX", postalCode: " 73301 " }),
    );
    expect(await getAddress(shopA, customerId, us.id)).toMatchObject({
      country: "US",
      postalCode: "73301",
      region: "TX",
    });
    // United Kingdom: postcodes are tidied to capitals.
    const uk = await createAddress(
      shopA,
      customerId,
      address({ country: "GB", city: "London", postalCode: "sw1a 1aa" }),
    );
    expect((await getAddress(shopA, customerId, uk.id)).postalCode).toBe("SW1A 1AA");
    // United Arab Emirates: no postal codes; an emirate is required.
    await expectError(
      createAddress(shopA, customerId, address({ country: "AE", city: "Dubai" })),
      "invalid",
    );
    const ae = await createAddress(
      shopA,
      customerId,
      address({ country: "AE", city: "Dubai", region: "Dubai", postalCode: "12345" }),
    );
    expect((await getAddress(shopA, customerId, ae.id)).postalCode).toBeNull();
    // Egypt: a postal code is welcome but not demanded.
    await createAddress(shopA, customerId, address());

    for (const bad of [
      address({ country: "XX" }),
      address({ country: "" }),
      address({ fullName: "  " }),
      address({ line1: "" }),
      address({ city: "c".repeat(101) }),
      address({ phone: "not a phone" }),
    ]) {
      await expectError(createAddress(shopA, customerId, bad), "invalid");
    }
  });

  it("belongs to one customer: another customer's ID opens nothing", async () => {
    const mine = await newCustomer();
    const theirs = await newCustomer();
    const { id } = await createAddress(shopA, mine.customerId, address());

    expect(await listAddresses(shopA, theirs.customerId)).toEqual([]);
    const attempts = [
      () => getAddress(shopA, theirs.customerId, id),
      () => updateAddress(shopA, theirs.customerId, id, address({ city: "Elsewhere" })),
      () => deleteAddress(shopA, theirs.customerId, id),
      () => setDefaultAddress(shopA, theirs.customerId, id, "shipping"),
      () => getAddress(shopA, mine.customerId, "not-an-id"),
      // The right customer, from the wrong store.
      () => getAddress(shopB, mine.customerId, id),
    ];
    for (const attempt of attempts) await expectError(attempt(), "not_found");
    expect((await getAddress(shopA, mine.customerId, id)).city).toBe("Cairo");
  });

  it(`holds ${MAX_ADDRESSES} addresses and no more`, async () => {
    const { customerId } = await newCustomer();
    for (let count = 0; count < MAX_ADDRESSES; count += 1) {
      await createAddress(shopA, customerId, address({ line1: `${count} Long Street` }));
    }
    await expectError(createAddress(shopA, customerId, address()), "too_many");
  });
});

describe("a cart that follows the customer", () => {
  async function variant(tenantId: string, price = 1000) {
    const tag = randomUUID().slice(0, 8);
    const product = await admin.product.create({
      data: { tenantId, name: `Thing ${tag}`, slug: `thing-${tag}`, status: "active" },
    });
    return admin.productVariant.create({
      data: {
        tenantId,
        productId: product.id,
        sku: `SKU-${tag}`,
        priceAmount: price,
        currency: "USD",
      },
    });
  }

  it("becomes the customer's on sign-in and is then closed to the guest token", async () => {
    const item = await variant(tenantA);
    const { token } = await addToCart(shopA, null, { variantId: item.id, quantity: 2 });
    const { customerId } = await newCustomer();

    await claimCartForCustomer(shopA, token, customerId);
    expect((await getCart(shopA, { customerId })).itemCount).toBe(2);
    // The token alone no longer opens it: a signed-out browser sees an empty cart.
    expect((await getCart(shopA, token)).lines).toEqual([]);
    expect((await getCart(shopA, { token })).lines).toEqual([]);

    // Adding while signed in needs no token and creates none.
    const added = await addToCart(shopA, { customerId }, { variantId: item.id, quantity: 1 });
    expect(added).toMatchObject({ token: null, tokenIsNew: false });
    expect(added.cart.itemCount).toBe(3);
  });

  it("merges a guest cart into the cart the customer already had", async () => {
    const shared = await variant(tenantA);
    const onlyGuest = await variant(tenantA, 500);
    const { customerId } = await newCustomer();
    await addToCart(shopA, { customerId }, { variantId: shared.id, quantity: 7 });

    const guest = await addToCart(shopA, null, { variantId: shared.id, quantity: 6 });
    await addToCart(shopA, guest.token, { variantId: onlyGuest.id, quantity: 2 });
    await claimCartForCustomer(shopA, guest.token, customerId);

    const cart = await getCart(shopA, { customerId });
    const quantities = new Map(cart.lines.map((line) => [line.variantId, line.quantity]));
    expect(quantities.get(shared.id)).toBe(MAX_LINE_QUANTITY);
    expect(quantities.get(onlyGuest.id)).toBe(2);
    expect(await admin.cart.count({ where: { tenantId: tenantA, customerId } })).toBe(1);
    expect((await getCart(shopA, guest.token)).lines).toEqual([]);
  });

  it("never lets one customer take or see another's cart", async () => {
    const item = await variant(tenantA);
    const first = await newCustomer();
    const second = await newCustomer();
    const guest = await addToCart(shopA, null, { variantId: item.id, quantity: 1 });
    await claimCartForCustomer(shopA, guest.token, first.customerId);

    // The same token presented for another customer claims nothing.
    await claimCartForCustomer(shopA, guest.token, second.customerId);
    expect((await getCart(shopA, { customerId: second.customerId })).lines).toEqual([]);
    expect((await getCart(shopA, { customerId: first.customerId })).itemCount).toBe(1);
    // Nor does the customer's ID open anything from another store.
    expect((await getCart(shopB, { customerId: first.customerId })).lines).toEqual([]);
  });
});

describe("what staff can see", () => {
  async function staff(role: SystemRoleKey): Promise<RequestContext> {
    const permissions = SYSTEM_ROLES.find((r) => r.key === role)!.permissions;
    return {
      requestId: `req-${run}`,
      ip: "203.0.113.41",
      userId: randomUUID(),
      isPlatformAdmin: false,
      tenantId: tenantA,
      tenantSlug: "x",
      tenantName: "x",
      storeId: null,
      roleKey: role,
      roleName: role,
      permissions: new Set<PermissionKey>(permissions as readonly PermissionKey[]),
    };
  }

  it("lists the store's customers without any password material", async () => {
    const { email } = await newCustomer(shopA, uniqueEmail("findme"));
    await newCustomer(shopB, uniqueEmail("elsewhere"));
    const context = await staff("store_owner");
    const list = await listCustomers(shopA, context, { search: "FINDME" });
    expect(list.items.map((item) => item.email)).toEqual([email]);
    expect(list.items[0]).toMatchObject({
      emailVerified: true,
      hasAccount: true,
      status: "active",
    });
    const { fields } = fieldsAndNumbers(list);
    expect([...fields].filter((field) => /password|hash|token/i.test(field))).toEqual([]);

    const all = await listCustomers(shopA, context);
    expect(all.items.some((item) => item.email.startsWith("elsewhere"))).toBe(false);
  });

  it("requires the permission", async () => {
    await expect(listCustomers(shopA, await staff("inventory_manager"))).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
});
