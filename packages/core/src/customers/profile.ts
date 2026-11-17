import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { formatMoney } from "../catalog/money";

// One customer as staff see them: who they are and everything that has
// happened with them, newest first, plus notes staff leave for each other.
// customers.read to see; customers.write to add a note. Notes are added,
// never edited or deleted (a correction is a new note).

export type TimelineKind = "account" | "order" | "review" | "photo" | "conversation" | "note";

export interface TimelineEntry {
  kind: TimelineKind;
  at: Date;
  title: string;
  detail: string | null;
  /** An admin page with more, when there is one. */
  href: string | null;
}

export interface StaffCustomerView {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  hasAccount: boolean;
  emailVerified: boolean;
  createdAt: Date;
  orderCount: number;
  /** Orders taken, less money given back, in the store's currency. */
  spent: { amount: number; currency: string };
  timeline: TimelineEntry[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TAKEN = ["confirmed", "paid", "fulfilled", "refunded"];
const ORDER_WORD: Record<string, string> = {
  pending_payment: "waiting for payment",
  confirmed: "confirmed, cash on delivery",
  paid: "paid",
  fulfilled: "sent",
  cancelled: "cancelled",
  refunded: "refunded",
};
const UGC_WORD: Record<string, string> = {
  pending: "waiting to be checked",
  approved: "shown",
  rejected: "rejected",
  hidden: "hidden",
  withdrawn: "permission withdrawn",
  removed: "removed",
};

export async function getCustomerForStaff(
  db: TenantDb,
  context: RequestContext,
  customerId: string,
): Promise<StaffCustomerView> {
  assertPermission(context, "customers.read");
  if (!UUID.test(customerId)) throw new NotFoundError("customer");
  return db.run(async (tx) => {
    const customer = await tx.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        email: true,
        name: true,
        phone: true,
        passwordHash: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });
    if (!customer) throw new NotFoundError("customer");
    const [store, orders, reviews, photos, conversations, notes] = await Promise.all([
      tx.store.findFirst({ select: { defaultCurrency: true }, orderBy: { createdAt: "asc" } }),
      tx.order.findMany({
        where: { customerId },
        select: {
          id: true,
          number: true,
          status: true,
          totalAmount: true,
          refundedAmount: true,
          currency: true,
          placedAt: true,
        },
        orderBy: { placedAt: "desc" },
        take: 100,
      }),
      tx.productReview.findMany({
        where: { customerId },
        select: {
          rating: true,
          status: true,
          createdAt: true,
          product: { select: { name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      tx.ugcItem.findMany({
        where: { customerId },
        select: { kind: true, status: true, createdAt: true, product: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      tx.supportConversation.findMany({
        where: { customerId },
        select: { id: true, subject: true, status: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      tx.customerNote.findMany({
        where: { customerId },
        select: { authorName: true, body: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);
    const currency = store?.defaultCurrency ?? "USD";
    const timeline: TimelineEntry[] = [
      {
        kind: "account" as const,
        at: customer.createdAt,
        title: customer.passwordHash ? "Created an account" : "First ordered as a guest",
        detail: null,
        href: null,
      },
      ...orders.map((order) => ({
        kind: "order" as const,
        at: order.placedAt,
        title: `Order #${order.number}, ${ORDER_WORD[order.status] ?? order.status}`,
        detail: formatMoney(order.totalAmount, order.currency),
        href: `/admin/orders/${order.id}`,
      })),
      ...reviews.map((review) => ({
        kind: "review" as const,
        at: review.createdAt,
        title: `Reviewed ${review.product.name}: ${review.rating} of 5`,
        detail: review.status === "approved" ? "Shown" : review.status,
        href: "/admin/reviews",
      })),
      ...photos.map((photo) => ({
        kind: "photo" as const,
        at: photo.createdAt,
        title: `Shared a ${photo.kind === "video" ? "video" : "photo"}${photo.product ? ` of ${photo.product.name}` : ""}`,
        detail: UGC_WORD[photo.status] ?? photo.status,
        href: "/admin/content",
      })),
      ...conversations.map((conversation) => ({
        kind: "conversation" as const,
        at: conversation.createdAt,
        title: `Wrote: ${conversation.subject}`,
        detail: conversation.status,
        href: `/admin/inbox/${conversation.id}`,
      })),
      ...notes.map((note) => ({
        kind: "note" as const,
        at: note.createdAt,
        title: `Note by ${note.authorName}`,
        detail: note.body,
        href: null,
      })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());

    const taken = orders.filter(
      (order) => TAKEN.includes(order.status) && order.currency === currency,
    );
    return {
      id: customer.id,
      email: customer.email,
      name: customer.name,
      phone: customer.phone,
      hasAccount: customer.passwordHash !== null,
      emailVerified: customer.emailVerifiedAt !== null,
      createdAt: customer.createdAt,
      orderCount: orders.length,
      spent: {
        amount: taken.reduce((sum, order) => sum + order.totalAmount - order.refundedAmount, 0),
        currency,
      },
      timeline,
    };
  });
}

export class CustomerNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CustomerNoteError";
  }
}

/** A note on a customer for other staff. */
export async function addCustomerNote(
  db: TenantDb,
  context: RequestContext,
  customerId: string,
  body: unknown,
): Promise<void> {
  assertPermission(context, "customers.write");
  if (!UUID.test(customerId)) throw new NotFoundError("customer");
  const text = typeof body === "string" ? body.trim() : "";
  if (text.length < 2) throw new CustomerNoteError("Write the note.");
  if (text.length > 2000)
    throw new CustomerNoteError("Shorten the note (2,000 characters at most).");
  await db.run(async (tx) => {
    const exists = await tx.customer.count({ where: { id: customerId } });
    if (!exists) throw new NotFoundError("customer");
    const user = await tx.user.findUnique({
      where: { id: context.userId },
      select: { name: true, email: true },
    });
    await tx.customerNote.create({
      data: {
        tenantId: db.tenantId,
        customerId,
        authorUserId: context.userId,
        authorName: (user?.name || user?.email || "Staff").slice(0, 100),
        body: text,
      },
    });
    await audit(tx, context, "customers.note_added", { type: "customer", id: customerId });
  });
}
