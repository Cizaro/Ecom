"use client";

import { cx } from "@ecom/ui";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Admin navigation links with the current page marked for all users. */
export function NavLinks({ items }: { items: { label: string; path: string }[] }) {
  const pathname = usePathname();
  return (
    <ul className="-mx-1 flex gap-1 overflow-x-auto">
      {items.map((item) => {
        const current =
          item.path === "/admin" ? pathname === "/admin" : pathname.startsWith(item.path);
        return (
          <li key={item.path}>
            <Link
              href={item.path}
              aria-current={current ? "page" : undefined}
              className={cx(
                "inline-flex min-h-10 items-center rounded-control px-3 text-sm font-medium whitespace-nowrap",
                current ? "bg-surface-muted text-ink" : "text-ink-muted hover:text-ink",
              )}
            >
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
