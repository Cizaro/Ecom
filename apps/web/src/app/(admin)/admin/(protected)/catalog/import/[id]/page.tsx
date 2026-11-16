import { getProductImport } from "@ecom/core";
import { Alert, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission, tenantDb } from "@/server/access";
import { orNotFound } from "@/server/catalog-forms";
import { ActionForm, CheckboxField, DangerForm } from "../../../../_components/form";
import { discardImportAction, runImportAction } from "../actions";

export const metadata: Metadata = { title: "Import" };

export default async function ImportResultPage({ params }: { params: Promise<{ id: string }> }) {
  const { context } = await requirePermission("catalog.write");
  const { id } = await params;
  const result = await orNotFound(getProductImport(tenantDb(context), context, id));
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={result.fileName}
        description={
          <>
            {plural(result.productCount, "product")}, {plural(result.variantCount, "variant")},{" "}
            {plural(result.imageCount, "picture link")}.{" "}
            <Link href="/admin/catalog/import" className="underline underline-offset-4">
              All imports
            </Link>
          </>
        }
      />

      {result.status === "checked" && result.problems.length > 0 ? (
        <>
          <Alert tone="error" testId="import-problems-alert">
            {plural(result.problems.length, "problem")} found. Fix them in your file and upload it
            again; nothing has been added.
          </Alert>
          <Card title="Problems">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm" data-testid="import-problems">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 pr-4">
                      Row
                    </th>
                    <th scope="col" className="py-2 pr-4">
                      Column
                    </th>
                    <th scope="col" className="py-2">
                      Problem
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.problems.map((problem, i) => (
                    <tr key={i} className="border-b border-line align-top">
                      <td className="py-2 pr-4">{problem.row}</td>
                      <td className="py-2 pr-4">{problem.column}</td>
                      <td className="py-2">{problem.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <DangerForm
            action={discardImportAction}
            submitLabel="Discard this file"
            confirmMessage="Discard this checked file? Nothing was added from it."
          >
            <input type="hidden" name="id" value={result.id} />
          </DangerForm>
        </>
      ) : null}

      {result.status === "checked" && result.problems.length === 0 ? (
        <Card title="Ready to import">
          <p className="text-sm" data-testid="import-ready">
            Every row is fine. Importing adds {plural(result.productCount, "product")} with{" "}
            {plural(result.variantCount, "variant")}; pictures are downloaded from their links
            afterwards.
          </p>
          <ActionForm
            action={runImportAction}
            submitLabel={`Import ${plural(result.productCount, "product")}`}
            testId="run-import-form"
          >
            <input type="hidden" name="id" value={result.id} />
            <CheckboxField
              label="Publish them now (otherwise they are added as drafts to check first)"
              name="publish"
            />
          </ActionForm>
        </Card>
      ) : null}

      {result.status === "imported" ? (
        <>
          <Alert tone="success" testId="import-done">
            Imported {plural(result.productCount, "product")}
            {result.publish ? " and published them" : " as drafts"}.
          </Alert>
          {result.imageCount > 0 ? (
            <Card title="Pictures">
              <p className="text-sm" data-testid="import-images">
                {result.images.done} added, {result.images.pending} waiting, {result.images.failed}{" "}
                could not be added.
                {result.images.pending > 0 ? " Reload this page to see progress." : ""}
              </p>
              {result.failedImages.length > 0 ? (
                <ul className="flex flex-col gap-1 text-sm" data-testid="import-failed-images">
                  {result.failedImages.map((image) => (
                    <li key={image.url}>
                      <Link
                        href={`/admin/catalog/products/${image.productId}`}
                        className="underline underline-offset-4"
                      >
                        Open product
                      </Link>{" "}
                      <span className="break-all text-ink-muted">{image.url}</span>: {image.error}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ) : null}
          {result.products.length > 0 ? (
            <Card title="Products added">
              <ul className="flex flex-col gap-1 text-sm" data-testid="import-products">
                {result.products.map((product) => (
                  <li key={product.id}>
                    <Link
                      href={`/admin/catalog/products/${product.id}`}
                      className="underline underline-offset-4"
                    >
                      {product.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}

      {result.status === "discarded" ? (
        <Alert tone="info">This file was discarded. Nothing was added from it.</Alert>
      ) : null}
    </div>
  );
}
