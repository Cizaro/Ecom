import { listMyUgc, productsCustomerReceived, ugcPermissionText, type UgcStatus } from "@ecom/core";
import { Card, inputClasses } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { MediaImage } from "@/components/media-image";
import { requireCustomer } from "@/server/customer";
import { ugcView } from "@/server/media";
import { storefrontDb } from "@/server/storefront";
import {
  AccountCheckbox,
  AccountField,
  AccountForm,
  AccountSelect,
  ButtonForm,
} from "../../_components/account-form";
import { shareUgcAction, withdrawUgcAction } from "../../ugc/actions";

export const metadata: Metadata = { title: "My photos" };

const STATUS: Record<UgcStatus, string> = {
  pending: "Waiting to be checked",
  approved: "Shown in the shop",
  rejected: "Not shown",
  hidden: "Not shown",
  withdrawn: "Permission withdrawn, deleted",
  removed: "Removed by the store",
};

export default async function MyPhotosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const customer = await requireCustomer("/account/photos");
  const { store, db } = await storefrontDb();
  const [items, products, params] = await Promise.all([
    listMyUgc(db, customer.id),
    productsCustomerReceived(db, customer.id),
    searchParams,
  ]);
  const wanted = typeof params.product === "string" ? params.product : "";
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium" });

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/account" className="text-sm underline underline-offset-4">
          Your account
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">My photos</h1>
        <p className="text-sm text-ink-muted">
          Share a photo or short video of something you bought. You can withdraw your permission at
          any time; it is then taken down and deleted.
        </p>
      </div>

      <Card title="Share a photo or video">
        {products.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="ugc-not-eligible">
            You can share photos of products once you have received them from an order.
          </p>
        ) : (
          <AccountForm action={shareUgcAction} submitLabel="Share" testId="ugc-form">
            <AccountSelect
              label="Product"
              name="productId"
              defaultValue={products.some((p) => p.id === wanted) ? wanted : ""}
              options={[
                { value: "", label: "Choose the product it shows" },
                ...products.map((product) => ({ value: product.id, label: product.name })),
              ]}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="ugc-file" className="text-sm font-medium">
                Photo or video
              </label>
              <input
                id="ugc-file"
                name="file"
                type="file"
                accept="image/jpeg,image/png,image/webp,video/mp4,video/quicktime"
                className={`${inputClasses} py-2`}
                aria-describedby="ugc-file-hint"
              />
              <p id="ugc-file-hint" className="text-sm text-ink-muted">
                A photo (JPEG, PNG) or a short video (MP4 or MOV), 8 MB at most.
              </p>
            </div>
            <AccountField label="Caption" name="caption" maxLength={300} hint="Optional" />
            <AccountField
              label="Name shown"
              name="creditName"
              maxLength={60}
              hint="Leave empty to show your first name and initial."
            />
            <AccountCheckbox label={ugcPermissionText(store.name)} name="permission" />
          </AccountForm>
        )}
      </Card>

      {items.length > 0 ? (
        <Card title="What you shared">
          <ul className="flex flex-col gap-4" data-testid="my-ugc">
            {items.map((item) => {
              const view = item.media ? ugcView(item.media) : null;
              const live = item.status !== "withdrawn" && item.status !== "removed";
              return (
                <li key={item.id} className="flex gap-3" data-testid="my-ugc-item">
                  <div className="h-24 w-20 shrink-0 overflow-hidden rounded-control bg-surface-muted">
                    {view?.kind === "image" ? (
                      <MediaImage
                        image={view.image}
                        alt=""
                        sizes="80px"
                        className="h-full w-full object-cover"
                      />
                    ) : view?.kind === "video" ? (
                      <video
                        src={view.url}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1 text-sm">
                    <span className="font-medium" data-testid="my-ugc-status">
                      {STATUS[item.status]}
                    </span>
                    <span className="text-ink-muted">
                      {item.productName ?? "Product"} · {when.format(item.createdAt)} · shown as{" "}
                      {item.creditName}
                    </span>
                    {live ? (
                      <ButtonForm
                        action={withdrawUgcAction}
                        label="Withdraw permission and delete"
                        tone="danger"
                        fields={{ id: item.id }}
                      />
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
