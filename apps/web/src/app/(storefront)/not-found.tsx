import { buttonClasses } from "@ecom/ui";
import Link from "next/link";
import { shopT } from "@/server/i18n";

// Shown inside the shop's header and footer when a product or category does
// not exist (or is not published). The reply is still a real 404.
export default async function StorefrontNotFound() {
  const t = await shopT();
  return (
    <div className="flex flex-col items-start gap-4 py-8" data-testid="shop-not-found">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        {t("We could not find that page")}
      </h1>
      <p className="max-w-prose text-ink-muted">
        {t("It may have been moved, or the product may no longer be for sale.")}
      </p>
      <div className="flex flex-wrap gap-3">
        <Link href="/products" className={buttonClasses()}>
          {t("See all products")}
        </Link>
        <Link href="/" className={buttonClasses("secondary")}>
          {t("Go to the home page")}
        </Link>
      </div>
    </div>
  );
}
