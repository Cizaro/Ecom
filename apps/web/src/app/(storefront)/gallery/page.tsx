import { listApprovedUgc } from "@ecom/core";
import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentCustomer } from "@/server/customer";
import { storefrontDb } from "@/server/storefront";
import { Breadcrumbs } from "../_components/breadcrumbs";
import { UgcGrid } from "../_components/ugc-grid";

export const metadata: Metadata = {
  title: "Customer photos",
  description: "Photos and videos shared by our customers, with their permission.",
  alternates: { canonical: "/gallery" },
};

// The gallery: approved photos and videos from customers and creators,
// featured ones first. Everything here was shared with permission.
export default async function GalleryPage() {
  const { db } = await storefrontDb();
  const [items, customer] = await Promise.all([
    listApprovedUgc(db, { limit: 60 }),
    getCurrentCustomer(),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <Breadcrumbs trail={[{ name: "Home", href: "/" }]} current="Customer photos" />
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Customer photos</h1>
        <p className="text-ink-muted">
          Shared by customers and creators, with their permission.{" "}
          <Link
            href={customer ? "/account/photos" : "/account/sign-in?next=%2Faccount%2Fphotos"}
            className="text-ink underline underline-offset-4"
          >
            Share yours
          </Link>
        </p>
      </div>
      {items.length > 0 ? (
        <UgcGrid items={items} />
      ) : (
        <p className="text-sm text-ink-muted" data-testid="ugc-empty">
          No photos yet.
        </p>
      )}
    </div>
  );
}
