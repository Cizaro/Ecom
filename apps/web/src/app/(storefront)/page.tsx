import { PageHeader } from "@ecom/ui";
import { requireStorefront } from "@/server/storefront";

// Storefront home. The real homepage is built in Milestone 2.3.
export default async function StorefrontHomePage() {
  const store = await requireStorefront();
  return (
    <PageHeader
      title={store.name}
      description="Our shop is opening soon. Bags, wallets, watches, jewelry and accessories."
    />
  );
}
