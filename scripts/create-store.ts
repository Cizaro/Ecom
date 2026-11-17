// Creates a store (tenant, store and its web address), or adds a web address
// to an existing one. For the platform owner setting up a live server.
//
//   pnpm store:create --slug cedar --name "Cedar Bags" --domain cedarbags.lb \
//     [--currency USD] [--timezone Asia/Beirut]
//
// Then create its owner:
//   pnpm admin:create --email you@yourdomain --name "Your Name" --tenant cedar

import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseEnv } from "@ecom/config";
import { isCurrencyCode, normalizeHost, recordAudit, safeTimeZone } from "@ecom/core";
import { disconnectDatabase, getAdminPrisma } from "@ecom/db";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: the server sets real environment variables.
}

const USAGE = `Usage: pnpm store:create --slug <slug> --name <store name> --domain <host name>
         [--currency USD] [--timezone Asia/Beirut]
If the store already exists, only the web address is added.`;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    slug: { type: "string" },
    name: { type: "string" },
    domain: { type: "string" },
    currency: { type: "string", default: "USD" },
    timezone: { type: "string", default: "UTC" },
  },
});

const slug = values.slug?.trim().toLowerCase() ?? "";
if (!/^[a-z0-9]([a-z0-9-]{0,40}[a-z0-9])?$/.test(slug))
  fail(`--slug: letters, digits and -\n${USAGE}`);
const host = normalizeHost(values.domain);
if (!host) fail(`--domain: a host name such as cedarbags.lb (no https://)\n${USAGE}`);
const currency = values.currency!.toUpperCase();
if (!isCurrencyCode(currency)) fail(`--currency: a currency code such as USD`);
const timezone = values.timezone!;
if (safeTimeZone(timezone) !== timezone) fail(`--timezone: a time zone such as Asia/Beirut`);

const env = parseEnv(process.env);
const prisma = getAdminPrisma(env.DATABASE_ADMIN_URL);
try {
  const taken = await prisma.storeDomain.findUnique({
    where: { hostname: host },
    select: { tenantId: true },
  });
  let tenant = await prisma.tenant.findUnique({
    where: { slug },
    include: { stores: { take: 1, orderBy: { createdAt: "asc" } } },
  });
  if (taken && taken.tenantId !== tenant?.id)
    fail(`The web address ${host} already belongs to another store.`);

  if (!tenant) {
    const name = values.name?.trim();
    if (!name) fail(`--name is needed for a new store\n${USAGE}`);
    tenant = await prisma.tenant.create({
      data: {
        slug,
        name,
        stores: { create: [{ name, slug: "main", defaultCurrency: currency, timezone }] },
      },
      include: { stores: { take: 1, orderBy: { createdAt: "asc" } } },
    });
    console.log(`store:create: created store "${name}" (${slug}), ${currency}, ${timezone}`);
  } else {
    console.log(`store:create: store "${tenant.name}" (${slug}) already exists`);
  }

  if (taken) {
    console.log(`store:create: ${host} is already this store's address`);
  } else {
    const hasPrimary =
      (await prisma.storeDomain.count({ where: { tenantId: tenant.id, isPrimary: true } })) > 0;
    await prisma.storeDomain.create({
      data: {
        tenantId: tenant.id,
        storeId: tenant.stores[0]!.id,
        hostname: host,
        isPrimary: !hasPrimary,
      },
    });
    await recordAudit(prisma, {
      tenantId: tenant.id,
      actorType: "system",
      actorUserId: null,
      action: "platform.store_domain_added",
      entityType: "store",
      entityId: tenant.stores[0]!.id,
      after: { hostname: host },
    });
    console.log(`store:create: ${host} now opens this store${hasPrimary ? "" : " (main address)"}`);
  }
  console.log(`Next: pnpm admin:create --email <you> --name "<Your Name>" --tenant ${slug}`);
} finally {
  await disconnectDatabase();
}
