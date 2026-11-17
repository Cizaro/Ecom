import type { ProductSuggestionView } from "@ecom/core";
import { Card, Checkbox } from "@ecom/ui";
import { ActionForm } from "../../../_components/form";
import {
  applyProductSuggestionAction,
  dismissProductSuggestionAction,
  draftProductCopyAction,
  draftProductTranslationAction,
} from "../ai-actions";

// The "AI drafts" panel on a product's page: buttons that ask the AI for a
// draft, and each waiting draft with a box per part, so staff apply only what
// they want. Drafts never change the product by themselves.

interface Part {
  field: string;
  label: string;
  value: string;
  rtl?: boolean;
}

function parts(draft: ProductSuggestionView): Part[] {
  if (draft.kind === "copy") {
    const p = draft.proposal;
    const list: Part[] = [
      { field: "shortDescription", label: "Short description", value: p.shortDescription },
      { field: "description", label: "Description", value: p.description },
      { field: "seoTitle", label: "Search title", value: p.seoTitle },
      { field: "seoDescription", label: "Search description", value: p.seoDescription },
    ];
    if (p.tags.length > 0) {
      list.push({
        field: "tags",
        label: "Tags (added to the current ones)",
        value: p.tags.join(", "),
      });
    }
    if (p.categoryId && draft.categoryName) {
      list.push({ field: "category", label: "Category", value: draft.categoryName });
    }
    return list;
  }
  const p = draft.proposal;
  return [
    { field: "name", label: "الاسم (Name)", value: p.name, rtl: true },
    {
      field: "shortDescription",
      label: "وصف قصير (Short description)",
      value: p.shortDescription,
      rtl: true,
    },
    { field: "description", label: "الوصف (Description)", value: p.description, rtl: true },
  ].filter((part) => part.value !== "");
}

const TITLE: Record<ProductSuggestionView["kind"], string> = {
  copy: "Wording and search text",
  translation: "Arabic wording",
};

export function ProductAiDrafts({
  productId,
  drafts,
  canDraft,
}: {
  productId: string;
  drafts: ProductSuggestionView[];
  /** Has catalog.write and ai.use. */
  canDraft: boolean;
}) {
  return (
    <Card
      title="AI drafts"
      description="The AI writes from this product's own details only. Check every draft: nothing changes until you apply it."
    >
      {canDraft ? (
        <div className="flex flex-wrap items-start gap-3">
          <ActionForm
            action={draftProductCopyAction}
            submitLabel="Draft wording and search text"
            submitTone="secondary"
            testId="ai-request-copy"
          >
            <input type="hidden" name="id" value={productId} />
          </ActionForm>
          <ActionForm
            action={draftProductTranslationAction}
            submitLabel="Draft Arabic wording"
            submitTone="secondary"
            testId="ai-request-arabic"
          >
            <input type="hidden" name="id" value={productId} />
          </ActionForm>
        </div>
      ) : null}

      {drafts.length === 0 ? (
        <p className="text-sm text-ink-muted">No drafts waiting.</p>
      ) : (
        drafts.map((draft) => (
          <section
            key={draft.id}
            data-testid={`ai-draft-${draft.kind}`}
            aria-label={`Draft: ${TITLE[draft.kind]}`}
            className="flex flex-col gap-4 rounded-card border border-line p-4"
          >
            <h3 className="font-semibold">
              Draft: {TITLE[draft.kind]}{" "}
              <span className="text-sm font-normal text-ink-muted">
                {draft.createdAt.toISOString().slice(0, 16).replace("T", " ")} UTC
              </span>
            </h3>
            <ActionForm
              action={applyProductSuggestionAction}
              submitLabel="Apply ticked parts"
              readOnly={!canDraft}
            >
              <input type="hidden" name="id" value={productId} />
              <input type="hidden" name="suggestionId" value={draft.id} />
              {parts(draft).map((part) => (
                <div key={part.field} className="flex flex-col gap-1">
                  <Checkbox
                    id={`${draft.id}-${part.field}`}
                    name="fields"
                    value={part.field}
                    label={part.label}
                    defaultChecked
                  />
                  <p
                    dir={part.rtl ? "rtl" : undefined}
                    lang={part.rtl ? "ar" : undefined}
                    className="whitespace-pre-line rounded-control bg-canvas px-3 py-2 text-sm"
                  >
                    {part.value}
                  </p>
                </div>
              ))}
            </ActionForm>
            {canDraft ? (
              <ActionForm
                action={dismissProductSuggestionAction}
                submitLabel="Dismiss draft"
                submitTone="secondary"
              >
                <input type="hidden" name="id" value={productId} />
                <input type="hidden" name="suggestionId" value={draft.id} />
              </ActionForm>
            ) : null}
          </section>
        ))
      )}
    </Card>
  );
}
