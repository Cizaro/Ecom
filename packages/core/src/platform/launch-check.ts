import type { Env } from "@ecom/config";
import { getAdminPrisma } from "@ecom/db";

// The checks before a store goes live: the server's settings, and the
// store's own setup. "fail" means real customers would be affected (emails
// not sent, test payments, an unsafe setting); "warn" means something to
// finish or decide; "pass" is fine. Run with: pnpm launch:check --tenant <slug>

export type LaunchStatus = "pass" | "warn" | "fail";

export interface LaunchFinding {
  status: LaunchStatus;
  area: "settings" | "store";
  label: string;
  detail: string;
}

type LaunchEnv = Pick<
  Env,
  | "NODE_ENV"
  | "APP_URL"
  | "EMAIL_PROVIDER"
  | "EMAIL_FROM"
  | "PAYMENT_PROVIDER"
  | "ALLOW_SEARCH_INDEXING"
  | "ALLOW_MOCK_PAYMENTS_IN_PRODUCTION"
  | "IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS"
  | "RATE_LIMIT_SCALE"
  | "TRUST_PROXY_HOPS"
  | "S3_PUBLIC_URL"
  | "AI_PROVIDER"
  | "AI_PAUSED"
  | "META_GRAPH_MODE"
  | "META_APP_ID"
>;

const finding = (
  status: LaunchStatus,
  label: string,
  detail: string,
  area: LaunchFinding["area"] = "settings",
): LaunchFinding => ({ status, area, label, detail });

/** The server's settings, from the validated environment. No secrets are printed. */
export function checkLaunchSettings(env: LaunchEnv): LaunchFinding[] {
  const results: LaunchFinding[] = [];
  results.push(
    env.NODE_ENV === "production"
      ? finding("pass", "Running mode", "production")
      : finding(
          "fail",
          "Running mode",
          `NODE_ENV is "${env.NODE_ENV}"; set it to production on the live server`,
        ),
  );
  const appUrl = new URL(env.APP_URL);
  results.push(
    appUrl.protocol === "https:"
      ? finding("pass", "Secure address", env.APP_URL)
      : finding(
          "fail",
          "Secure address",
          "APP_URL must start with https:// on the live site (sign-in cookies need it)",
        ),
  );
  if (
    ["localhost", "127.0.0.1"].includes(appUrl.hostname) ||
    appUrl.hostname.endsWith(".localhost")
  ) {
    results.push(
      finding("fail", "Public address", "APP_URL points at this computer, not the live address"),
    );
  }
  results.push(
    env.EMAIL_PROVIDER === "smtp"
      ? finding("pass", "Email sending", `SMTP, sent from ${env.EMAIL_FROM}`)
      : finding(
          "fail",
          "Email sending",
          "EMAIL_PROVIDER is console: no email would reach customers. Set up an SMTP service",
        ),
  );
  if (/example\.(com|test)$|localhost$/i.test(env.EMAIL_FROM)) {
    results.push(finding("fail", "Sender address", "EMAIL_FROM is still an example address"));
  }
  results.push(
    env.PAYMENT_PROVIDER === "none"
      ? finding("pass", "Payments", "cash on delivery only")
      : finding(
          "fail",
          "Payments",
          "the test payment provider is on: set PAYMENT_PROVIDER=none until a card gateway is connected",
        ),
  );
  // AI is optional: the stand-in costs nothing and invents nothing, but answers little.
  results.push(
    env.AI_PAUSED
      ? finding("warn", "AI", "paused for every store (AI_PAUSED=true)")
      : env.AI_PROVIDER === "mock"
        ? finding(
            "warn",
            "AI",
            "the built-in test stand-in is on; set AI_PROVIDER=anthropic and AI_API_KEY to use a real AI",
          )
        : env.AI_PROVIDER === "groq" || env.AI_PROVIDER === "moonshot"
          ? finding(
              "warn",
              "AI",
              `provider: ${env.AI_PROVIDER}; check its terms before sending real customer messages (free plans may keep them)`,
            )
          : finding("pass", "AI", `provider: ${env.AI_PROVIDER}`),
  );
  if (env.ALLOW_MOCK_PAYMENTS_IN_PRODUCTION) {
    results.push(
      finding(
        "fail",
        "Test switch",
        "ALLOW_MOCK_PAYMENTS_IN_PRODUCTION is for automated tests only",
      ),
    );
  }
  if (env.IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS) {
    results.push(
      finding(
        "fail",
        "Test switch",
        "IMPORT_ALLOW_PRIVATE_IMAGE_HOSTS is for automated tests only",
      ),
    );
  }
  if (env.META_GRAPH_MODE === "fake") {
    results.push(
      finding(
        "fail",
        "Test switch",
        "META_GRAPH_MODE=fake is a stand-in that never talks to Meta; set it to live",
      ),
    );
  }
  results.push(
    env.META_APP_ID
      ? finding("pass", "Instagram and Facebook", "Meta app configured")
      : finding(
          "warn",
          "Instagram and Facebook",
          "no Meta app: messages, comments and publishing stay off (docs/META_SETUP.md)",
        ),
  );
  if (env.RATE_LIMIT_SCALE !== 1) {
    results.push(
      finding("fail", "Test switch", "RATE_LIMIT_SCALE is for automated tests only; set it to 1"),
    );
  }
  results.push(
    env.TRUST_PROXY_HOPS === 0
      ? finding(
          "warn",
          "Visitor addresses",
          "TRUST_PROXY_HOPS is 0: every visitor shares one set of limits. Set it to the number of proxies in front of the app (usually 1).",
        )
      : finding(
          "pass",
          "Visitor addresses",
          `taken from the proxy ${env.TRUST_PROXY_HOPS === 1 ? "in front of the app" : `${env.TRUST_PROXY_HOPS} hops in`}`,
        ),
  );
  results.push(
    env.ALLOW_SEARCH_INDEXING
      ? finding("pass", "Search engines", "allowed to list the shop")
      : finding(
          "warn",
          "Search engines",
          "ALLOW_SEARCH_INDEXING is false: Google will not list the shop",
        ),
  );
  if (env.S3_PUBLIC_URL && !env.S3_PUBLIC_URL.startsWith("https://")) {
    results.push(
      finding("fail", "Pictures address", "S3_PUBLIC_URL must be https:// on the live site"),
    );
  }
  return results;
}

/** One store's setup, read with the admin connection. */
export async function checkLaunchStore(
  adminDatabaseUrl: string,
  tenantSlug: string,
): Promise<LaunchFinding[]> {
  const prisma = getAdminPrisma(adminDatabaseUrl);
  const tenant = await prisma.tenant.findUnique({
    where: { slug: tenantSlug },
    select: { id: true, requireStaffTwoFactor: true },
  });
  if (!tenant) return [finding("fail", "Store", `no store with the slug "${tenantSlug}"`, "store")];
  const tenantId = tenant.id;
  const [domains, products, zones, tax, pages, settings, owners] = await Promise.all([
    prisma.storeDomain.findMany({ where: { tenantId }, select: { hostname: true } }),
    prisma.product.count({ where: { tenantId, status: "active" } }),
    prisma.shippingZone.count({ where: { tenantId, isActive: true } }),
    prisma.checkoutSettings.findUnique({
      where: { tenantId },
      select: { taxRateBasisPoints: true },
    }),
    prisma.storePage.findMany({ where: { tenantId, published: true }, select: { slug: true } }),
    prisma.notificationSettings.findUnique({
      where: { tenantId },
      select: { orderEmails: true, supportEmails: true },
    }),
    prisma.userTenantMembership.findMany({
      where: { tenantId, role: { key: "store_owner" } },
      select: { user: { select: { email: true, twoFactorEnabled: true } } },
    }),
  ]);
  const store = (status: LaunchStatus, label: string, detail: string) =>
    finding(status, label, detail, "store");
  const results: LaunchFinding[] = [];
  const publicDomains = domains.filter(
    (d) => !["localhost", "127.0.0.1"].includes(d.hostname) && !d.hostname.endsWith(".localhost"),
  );
  results.push(
    publicDomains.length > 0
      ? store("pass", "Web address", publicDomains.map((d) => d.hostname).join(", "))
      : store("fail", "Web address", "the store has no public web address yet"),
  );
  results.push(
    products > 0
      ? store("pass", "Products", `${products} published`)
      : store("fail", "Products", "no published products"),
  );
  results.push(
    zones > 0
      ? store("pass", "Delivery areas", `${zones} offered`)
      : store(
          "warn",
          "Delivery areas",
          "none: checkout charges no delivery and accepts any country",
        ),
  );
  results.push(
    tax && tax.taxRateBasisPoints > 0
      ? store("pass", "Tax", `${tax.taxRateBasisPoints / 100}%`)
      : store("warn", "Tax", "0%: confirm with your accountant whether VAT applies"),
  );
  const published = new Set(pages.map((p) => p.slug));
  for (const slug of ["returns", "delivery", "privacy", "terms"]) {
    results.push(
      published.has(slug)
        ? store("pass", `Policy page: ${slug}`, "published")
        : store("warn", `Policy page: ${slug}`, "not published yet (Policy pages in the admin)"),
    );
  }
  results.push(
    settings?.orderEmails.length
      ? store("pass", "New-order emails", settings.orderEmails.join(", "))
      : store(
          "warn",
          "New-order emails",
          "no staff address is told about new orders (Store emails)",
        ),
  );
  results.push(
    settings?.supportEmails.length
      ? store("pass", "Message emails", settings.supportEmails.join(", "))
      : store(
          "warn",
          "Message emails",
          "no staff address is told about customer messages (Store emails)",
        ),
  );
  const withoutTwoFactor = owners.filter((o) => !o.user.twoFactorEnabled).map((o) => o.user.email);
  results.push(
    owners.length === 0
      ? store("fail", "Owner", "the store has no owner account")
      : withoutTwoFactor.length > 0
        ? store("warn", "Two-factor sign-in", `owners without it: ${withoutTwoFactor.join(", ")}`)
        : store("pass", "Two-factor sign-in", "on for every owner"),
  );
  results.push(
    tenant.requireStaffTwoFactor
      ? store("pass", "Two-factor required", "owners and managers must use it")
      : store(
          "warn",
          "Two-factor required",
          'owners and managers may sign in with a password alone; turn it on in Team (Require two-factor sign-in)',
        ),
  );
  return results;
}
