import { msg } from "@ecom/i18n";
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
import { shopT } from "@/server/i18n";

export async function generateMetadata(): Promise<Metadata> {
  const t = await shopT();
  return { title: t("My photos") };
}

const STATUS: Record<UgcStatus, string> = {
  pending: msg("Waiting to be checked"),
  approved: msg("Shown in the shop"),
  rejected: msg("Not shown"),
  hidden: msg("Not shown"),
  withdrawn: msg("Permission withdrawn, deleted"),
  removed: msg("Removed by the store"),
};

export default async function MyPhotosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await shopT();
  const customer = await requireCustomer("/account/photos");
  const { store, db } = await storefrontDb();
  const [items, products, params] = await Promise.all([
    listMyUgc(db, customer.id),
    productsCustomerReceived(db, customer.id),
    searchParams,
  ]);
  const wanted = typeof params.product === "string" ? params.product : "";
  const when = new Intl.DateTimeFormat(t.intl, { dateStyle: "medium" });

  return (
    <>
      <div className="flex flex-col gap-1">
        <Link href="/account" className="text-sm underline underline-offset-4">
          {t("Your account")}
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight">{t("My photos")}</h1>
        <p className="text-sm text-ink-muted">
          {t(
            "Share a photo or short video of something you bought. You can withdraw your permission at any time; it is then taken down and deleted.",
          )}
        </p>
      </div>

      <Card title={t("Share a photo or video")}>
        {products.length === 0 ? (
          <p className="text-sm text-ink-muted" data-testid="ugc-not-eligible">
            {t("You can share photos of products once you have received them from an order.")}
          </p>
        ) : (
          <AccountForm action={shareUgcAction} submitLabel={t("Share")} testId="ugc-form">
            <AccountSelect
              label={t("Product")}
              name="productId"
              defaultValue={products.some((p) => p.id === wanted) ? wanted : ""}
              options={[
                { value: "", label: t("Choose the product it shows") },
                ...products.map((product) => ({ value: product.id, label: product.name })),
              ]}
            />
            <div className="flex flex-col gap-1">
              <label htmlFor="ugc-file" className="text-sm font-medium">
                {t("Photo or video")}
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
                {t("A photo (JPEG, PNG) or a short video (MP4 or MOV), 8 MB at most.")}
              </p>
            </div>
            <AccountField
              label={t("Caption")}
              name="caption"
              maxLength={300}
              hint={t("Optional")}
            />
            <AccountField
              label={t("Name shown")}
              name="creditName"
              maxLength={60}
              hint={t("Leave empty to show your first name and initial.")}
            />
            <AccountCheckbox label={ugcPermissionText(store.name)} name="permission" />
          </AccountForm>
        )}
      </Card>

      {items.length > 0 ? (
        <Card title={t("What you shared")}>
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
                      {t(STATUS[item.status])}
                    </span>
                    <span className="text-ink-muted">
                      {item.productName ?? t("Product")} · {when.format(item.createdAt)} ·{" "}
                      {t("shown as {name}", { name: item.creditName })}
                    </span>
                    {live ? (
                      <ButtonForm
                        action={withdrawUgcAction}
                        label={t("Withdraw permission and delete")}
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
