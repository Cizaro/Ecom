import { importTemplateFor } from "@ecom/core";
import { tenantDb } from "@/server/access";
import { apiRoute } from "@/server/api";

// The product import spreadsheet for this store: its categories and brands
// are dropdowns in the Category and Brand columns.
export const GET = apiRoute(
  { access: { level: "permission", permission: "catalog.write" } },
  async ({ context }) => {
    const template = await importTemplateFor(tenantDb(context), context);
    return new Response(Buffer.from(template.bytes), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${template.filename}"`,
      },
    });
  },
);
