import { deliverPaymentNotification } from "@/server/payments";

// Where the payment provider sends its notifications. Public by design: what
// protects it is the signature on every notification (checked before
// anything happens), its freshness, and each notification being acted on
// once. The answer says only whether it was accepted.
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

export async function POST(request: Request): Promise<Response> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  const { outcome } = await deliverPaymentNotification(rawBody, request.headers);
  if (outcome === "rejected") {
    return Response.json({ received: false }, { status: 400 });
  }
  // Everything else is "received": the provider must not keep resending a
  // notification we have recorded or deliberately ignored.
  return Response.json({ received: true });
}
