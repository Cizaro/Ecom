// Fills the demo store with sample products so the storefront has something
// to show on a development computer. Run with: pnpm demo:catalog
//
// - Development only: refuses to run when NODE_ENV is production.
// - Everything is named "Sample ..." and the pictures are generated shapes,
//   not photographs of real goods.
// - Safe to run again: a product whose URL name already exists is skipped.
// - Goes through the same services as the admin, so every rule applies.

import { resolve } from "node:path";
import { parseEnv } from "@ecom/config";
import {
  addProductImage,
  addVariant,
  createBrand,
  createProduct,
  createS3Storage,
  createTenantDb,
  DEMO_TENANT_SLUG,
  listBrands,
  listCategories,
  processMediaAsset,
  setCategoryImage,
  setProductStatus,
  SYSTEM_ROLES,
  updateProduct,
  type PermissionKey,
  type RequestContext,
} from "@ecom/core";
import { disconnectDatabase, getAdminPrisma, getAppPrisma } from "@ecom/db";
import sharp from "sharp";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  // No .env file: variables come from the real environment.
}
const env = parseEnv(process.env);
if (env.NODE_ENV === "production") {
  console.error("demo:catalog is for development only.");
  process.exit(1);
}

type Shape = "bag" | "wallet" | "watch" | "ring" | "scarf";

const SHAPES: Record<Shape, (fill: string) => string> = {
  bag: (fill) =>
    `<path d="M430 420 Q600 150 770 420" stroke="${fill}" stroke-width="34" fill="none"/>
     <rect x="330" y="410" width="540" height="520" rx="60" fill="${fill}"/>`,
  wallet: (fill) =>
    `<rect x="300" y="430" width="600" height="400" rx="40" fill="${fill}"/>
     <rect x="300" y="520" width="600" height="16" fill="#00000030"/>
     <circle cx="820" cy="630" r="26" fill="#ffffff80"/>`,
  watch: (fill) =>
    `<rect x="520" y="180" width="160" height="840" rx="40" fill="${fill}"/>
     <circle cx="600" cy="600" r="200" fill="#f5f5f4" stroke="${fill}" stroke-width="40"/>
     <path d="M600 600 L600 480 M600 600 L680 640" stroke="#1c1917" stroke-width="16" stroke-linecap="round"/>`,
  ring: (fill) =>
    `<circle cx="600" cy="660" r="210" fill="none" stroke="${fill}" stroke-width="56"/>
     <path d="M540 440 L600 350 L660 440 L600 500 Z" fill="#e7e5e4" stroke="${fill}" stroke-width="12"/>`,
  scarf: (fill) =>
    `<path d="M300 380 C500 300 700 460 900 380 L900 560 C700 640 500 480 300 560 Z" fill="${fill}"/>
     <path d="M520 540 L480 900 L600 860 L640 560 Z" fill="${fill}"/>`,
};

async function picture(shape: Shape, fill: string, background: string): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1500" viewBox="0 0 1200 1200" preserveAspectRatio="xMidYMid slice">
    <rect width="1200" height="1200" fill="${background}"/>
    <ellipse cx="600" cy="1010" rx="360" ry="36" fill="#00000014"/>
    ${SHAPES[shape](fill)}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

interface Sample {
  name: string;
  category: string;
  brand: string;
  shape: Shape;
  material: string;
  short: string;
  tags: string[];
  featured?: boolean;
  isNew?: boolean;
  variants: { color: string; fill: string; price: number; sale?: number }[];
}

const BRANDS = ["Sample Atelier", "Sample & Co"];
const BG = "#ece7e1";

const SAMPLES: Sample[] = [
  {
    name: "Sample Everyday Tote",
    category: "womens-bags",
    brand: "Sample Atelier",
    shape: "bag",
    material: "Pebbled leather",
    short: "A roomy tote with an inside zip pocket.",
    tags: ["women"],
    featured: true,
    variants: [
      { color: "Black", fill: "#1c1917", price: 12900 },
      { color: "Tan", fill: "#b45309", price: 12900 },
    ],
  },
  {
    name: "Sample Crossbody Bag",
    category: "womens-bags",
    brand: "Sample & Co",
    shape: "bag",
    material: "Smooth leather",
    short: "Compact crossbody with an adjustable strap.",
    tags: ["women", "gift"],
    isNew: true,
    variants: [
      { color: "Burgundy", fill: "#7f1d1d", price: 8900 },
      { color: "Olive", fill: "#4d5a2c", price: 8900, sale: 6900 },
    ],
  },
  {
    name: "Sample Mini Bucket Bag",
    category: "womens-bags",
    brand: "Sample Atelier",
    shape: "bag",
    material: "Suede",
    short: "Drawstring bucket bag for the essentials.",
    tags: ["women"],
    variants: [{ color: "Sand", fill: "#c2a878", price: 7400 }],
  },
  {
    name: "Sample Bifold Wallet Classic",
    category: "mens-wallets",
    brand: "Sample & Co",
    shape: "wallet",
    material: "Full-grain leather",
    short: "Eight card slots and a note compartment.",
    tags: ["men", "gift"],
    featured: true,
    variants: [
      { color: "Brown", fill: "#6b4423", price: 4500 },
      { color: "Black", fill: "#1c1917", price: 4500 },
    ],
  },
  {
    name: "Sample Slim Card Holder",
    category: "mens-wallets",
    brand: "Sample Atelier",
    shape: "wallet",
    material: "Saffiano leather",
    short: "Holds six cards and slips into a front pocket.",
    tags: ["men"],
    isNew: true,
    variants: [{ color: "Navy", fill: "#1e3a5f", price: 2900 }],
  },
  {
    name: "Sample Field Watch",
    category: "watches",
    brand: "Sample & Co",
    shape: "watch",
    material: "Steel case, leather strap",
    short: "A 38 mm three-hand watch with a domed crystal.",
    tags: ["men", "women"],
    featured: true,
    variants: [
      { color: "Brown strap", fill: "#6b4423", price: 18900 },
      { color: "Black strap", fill: "#1c1917", price: 18900 },
    ],
  },
  {
    name: "Sample Dress Watch",
    category: "watches",
    brand: "Sample Atelier",
    shape: "watch",
    material: "Gold-tone case, mesh strap",
    short: "Slim two-hand dress watch.",
    tags: ["women", "gift"],
    variants: [{ color: "Gold", fill: "#b8893b", price: 22900, sale: 19900 }],
  },
  {
    name: "Sample Solitaire Ring",
    category: "jewelry",
    brand: "Sample Atelier",
    shape: "ring",
    material: "Sterling silver",
    short: "A single-stone ring with a polished band.",
    tags: ["women", "gift"],
    isNew: true,
    variants: [
      { color: "Silver", fill: "#9ca3af", price: 6400 },
      { color: "Gold", fill: "#b8893b", price: 7900 },
    ],
  },
  {
    name: "Sample Signet Ring",
    category: "jewelry",
    brand: "Sample & Co",
    shape: "ring",
    material: "Brass, gold plated",
    short: "A flat-top signet ring.",
    tags: ["men"],
    variants: [{ color: "Gold", fill: "#b8893b", price: 5200 }],
  },
  {
    name: "Sample Wool Scarf",
    category: "accessories",
    brand: "Sample & Co",
    shape: "scarf",
    material: "Merino wool",
    short: "A soft scarf, 180 cm long.",
    tags: ["women", "men", "gift"],
    variants: [
      { color: "Grey", fill: "#6b7280", price: 3900 },
      { color: "Rust", fill: "#b45309", price: 3900 },
      { color: "Forest", fill: "#2f4f3a", price: 3900 },
    ],
  },
];

const CATEGORY_ART: Record<string, { shape: Shape; fill: string }> = {
  "womens-bags": { shape: "bag", fill: "#b45309" },
  "mens-wallets": { shape: "wallet", fill: "#6b4423" },
  watches: { shape: "watch", fill: "#1c1917" },
  jewelry: { shape: "ring", fill: "#b8893b" },
  accessories: { shape: "scarf", fill: "#6b7280" },
};

const admin = getAdminPrisma(env.DATABASE_ADMIN_URL);
const storage = createS3Storage(env);
const deps = { storage };

try {
  const tenant = await admin.tenant.findUnique({
    where: { slug: DEMO_TENANT_SLUG },
    include: {
      stores: { take: 1, orderBy: { createdAt: "asc" } },
      memberships: { take: 1, orderBy: { createdAt: "asc" } },
    },
  });
  const member = tenant?.memberships[0];
  if (!tenant || !member) {
    console.error("demo:catalog: no demo store with a staff user. Run `pnpm db:seed` first.");
    process.exit(1);
  }
  const context: RequestContext = {
    requestId: "demo-catalog",
    ip: "127.0.0.1",
    userId: member.userId,
    isPlatformAdmin: false,
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    tenantName: tenant.name,
    storeId: tenant.stores[0]?.id ?? null,
    roleKey: "store_owner",
    roleName: "Store owner",
    permissions: new Set<PermissionKey>(
      SYSTEM_ROLES.find((role) => role.key === "store_owner")!
        .permissions as readonly PermissionKey[],
    ),
  };
  const db = createTenantDb(getAppPrisma(env.DATABASE_URL), context);

  const categories = new Map((await listCategories(db, context)).map((c) => [c.slug, c.id]));
  const brands = new Map((await listBrands(db, context)).map((b) => [b.name, b.id]));
  for (const name of BRANDS) {
    if (!brands.has(name)) brands.set(name, (await createBrand(db, context, { name })).id);
  }

  let categoryImages = 0;
  for (const [slug, art] of Object.entries(CATEGORY_ART)) {
    const id = categories.get(slug);
    if (!id) continue;
    const existing = await admin.category.findUnique({ where: { id } });
    if (existing?.imageAssetId) continue;
    const { assetId } = await setCategoryImage(
      db,
      context,
      deps,
      id,
      await picture(art.shape, art.fill, "#e7e2da"),
    );
    await processMediaAsset(db, storage, assetId);
    categoryImages += 1;
  }

  let created = 0;
  let skipped = 0;
  for (const sample of SAMPLES) {
    const slug = sample.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    if (await admin.product.findFirst({ where: { tenantId: tenant.id, slug } })) {
      skipped += 1;
      continue;
    }
    const categoryId = categories.get(sample.category) ?? "";
    const brandId = brands.get(sample.brand) ?? "";
    const product = await createProduct(db, context, {
      name: sample.name,
      slug,
      categoryId,
      brandId,
    });
    await updateProduct(db, context, product.id, {
      name: sample.name,
      slug,
      categoryId,
      brandId,
      shortDescription: sample.short,
      description: `${sample.short}\n\nThis is a sample product for trying out the store. It is not for sale.`,
      audienceTags: sample.tags,
      material: sample.material,
      isFeatured: sample.featured ?? false,
      isNewArrival: sample.isNew ?? false,
      isBestSeller: false,
      attributes: [],
    });
    for (const [index, variant] of sample.variants.entries()) {
      const added = await addVariant(db, context, product.id, {
        sku: `${slug.replace(/^sample-/, "SMP-")}-${index + 1}`.toUpperCase(),
        color: variant.color,
        priceAmount: variant.price,
        discountPriceAmount: variant.sale ?? null,
      });
      const image = await addProductImage(db, context, deps, product.id, {
        bytes: await picture(sample.shape, variant.fill, BG),
        altText: `${sample.name} in ${variant.color.toLowerCase()} (sample illustration)`,
      });
      await processMediaAsset(db, storage, image.assetId);
      await admin.productImage.update({
        where: { id: image.id },
        data: { variantId: added.id },
      });
    }
    await setProductStatus(db, context, product.id, "active");
    created += 1;
  }

  console.log(
    `demo:catalog: ${created} sample products added, ${skipped} already there, ` +
      `${categoryImages} category images added. See ${env.APP_URL}`,
  );
} finally {
  await disconnectDatabase();
}
