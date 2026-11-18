import { getAnalyticsReport, productsCsv } from "@ecom/core";
import { z } from "zod";
import { tenantDb } from "@/server/access";
import { apiRoute } from "@/server/api";

// The reports page's product table as a CSV file (Milestone 7.4). Product
// figures only: no customer details, so reports.read is enough.
export const GET = apiRoute(
  {
    access: { level: "permission", permission: "reports.read" },
    query: z.strictObject({ days: z.enum(["7", "30", "90"]).optional() }),
  },
  async ({ context, query }) => {
    const report = await getAnalyticsReport(tenantDb(context), context, query.days ?? "30");
    const { csv, filename } = productsCsv(report);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  },
);
