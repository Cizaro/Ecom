import Link from "next/link";
import { shopT } from "@/server/i18n";

/** Where this page sits in the shop: links up the tree, then the current page. */
export async function Breadcrumbs({
  trail,
  current,
}: {
  trail: readonly { name: string; href: string }[];
  current: string;
}) {
  const t = await shopT();
  return (
    <nav aria-label={t("Breadcrumb")} className="text-sm text-ink-muted">
      <ol className="flex flex-wrap items-center gap-x-2">
        {trail.map((step) => (
          <li key={step.href} className="flex items-center gap-x-2">
            <Link href={step.href} className="underline underline-offset-4">
              {step.name}
            </Link>
            <span aria-hidden="true">/</span>
          </li>
        ))}
        <li aria-current="page" className="text-ink">
          {current}
        </li>
      </ol>
    </nav>
  );
}
