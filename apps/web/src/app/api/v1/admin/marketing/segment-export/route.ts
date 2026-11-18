import { exportSegmentCsv } from "@ecom/core";
import { z } from "zod";
import { tenantDb } from "@/server/access";
import { apiRoute } from "@/server/api";

// A segment's customers who agreed to marketing emails, as CSV (email, name);
// without an id, every customer who agreed.
// Contact details: customers.export is required (the service also checks
// marketing.write) and every export is written to the audit log.
export const GET = apiRoute(
  {
    access: { level: "permission", permission: "customers.export" },
    query: z.strictObject({ id: z.uuid().optional() }),
  },
  async ({ context, query }) => {
    const result = await exportSegmentCsv(tenantDb(context), context, query.id ?? null);
    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Export-Rows": String(result.count),
      },
    });
  },
);
