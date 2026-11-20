import { SHOP_TEMPLATES } from "@ecom/core";
import { buttonClasses } from "@ecom/ui";
import type { Metadata } from "next";
import Link from "next/link";
import { requirePlatformSite } from "@/server/platform-site";
import { TemplatePreview } from "../parts";

export const metadata: Metadata = { title: "Templates" };

// The ready-made looks a new shop can start from. Each can be changed later
// in the shop's settings (colours, font, corners, logo).
export default async function TemplatesPage() {
  await requirePlatformSite();
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-12 md:py-16">
      <div className="flex max-w-2xl flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">Shop templates</h1>
        <p className="text-lg text-ink-muted">
          Pick a starting look. You can change the colours, font, corners and logo any time, and the
          shop works in English and Arabic with every template.
        </p>
      </div>
      <ul className="grid gap-8 sm:grid-cols-2" data-testid="template-list">
        {SHOP_TEMPLATES.map((template) => (
          <li key={template.key} className="flex flex-col gap-4">
            <TemplatePreview template={template} />
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex flex-col gap-1">
                <h2 className="text-xl font-semibold">{template.name}</h2>
                <p className="text-sm text-ink-muted">{template.description}</p>
              </div>
              <Link
                href={`/signup?template=${template.key}`}
                className={buttonClasses("secondary", "px-4")}
              >
                Use this template<span className="sr-only">: {template.name}</span>
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <p className="text-sm text-ink-muted">
        More templates and a drag-and-drop page builder are on the way.
      </p>
    </div>
  );
}
