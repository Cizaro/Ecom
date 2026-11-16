import { exportOrdersCsv, ORDER_STATUSES, PAYMENT_METHODS } from "@ecom/core";
import { z } from "zod";
import { tenantDb } from "@/server/access";
import { apiRoute } from "@/server/api";

// The orders matching the Orders page filters, as a CSV file. Customers'
// contact details are in it: customers.export is required and every export
// is written to the audit log.
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD");

export const GET = apiRoute(
  {
    access: { level: "permission", permission: "customers.export" },
    query: z.strictObject({
      q: z.string().max(100).optional(),
      status: z.enum(ORDER_STATUSES).optional(),
      payment: z.enum(PAYMENT_METHODS).optional(),
      from: day.optional(),
      to: day.optional(),
    }),
  },
  async ({ context, query }) => {
    const result = await exportOrdersCsv(tenantDb(context), context, {
      search: query.q,
      status: query.status,
      paymentMethod: query.payment,
      from: query.from,
      to: query.to,
    });
    return new Response(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "X-Export-Rows": String(result.count),
        "X-Export-Truncated": String(result.truncated),
      },
    });
  },
);
