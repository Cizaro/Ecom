"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/admin/platform", label: "Dashboard", exact: true },
  { href: "/admin/platform/shops", label: "Shops", exact: true },
  { href: "/admin/platform/shops/new", label: "New shop", exact: true },
  { href: "/admin/platform/billing", label: "Billing", exact: true },
  { href: "/admin/platform/plans", label: "Plans", exact: true },
] as const;

/** The panel's sidebar links, the current one marked. */
export function PlatformNav() {
  const path = usePathname();
  return (
    <nav aria-label="Platform">
      <ul className="flex gap-1 overflow-x-auto text-sm lg:flex-col">
        {ITEMS.map((item) => {
          const current =
            path === item.href ||
            (item.href === "/admin/platform/shops" &&
              path.startsWith("/admin/platform/shops/") &&
              path !== "/admin/platform/shops/new");
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={`flex min-h-10 items-center rounded-control px-3 whitespace-nowrap ${
                  current ? "bg-surface font-medium text-ink" : "opacity-90 hover:bg-brand-hover"
                }`}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
