import Link from "next/link";

/** Where this page sits in the shop: links up the tree, then the current page. */
export function Breadcrumbs({
  trail,
  current,
}: {
  trail: readonly { name: string; href: string }[];
  current: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-ink-muted">
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
