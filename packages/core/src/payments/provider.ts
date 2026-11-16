import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// Payment providers. The application never sees or stores card details: the
// shopper pays on the provider's page and the provider tells us the outcome
// with a signed notification (a webhook). Only that notification, once its
// signature checks out, can mark a payment as succeeded.

export interface CreatePaymentRequest {
  orderId: string;
  /** Minor units. */
  amount: number;
  currency: string;
  /** Where the shopper comes back to after paying. */
  returnUrl: string;
}

export interface CreatedPayment {
  providerPaymentId: string;
  /** Where to send the shopper to pay. */
  payUrl: string;
}

/** A notification from the provider, after its signature has been checked. */
export interface PaymentNotification {
  eventId: string;
  type: "payment.succeeded" | "payment.failed";
  providerPaymentId: string;
  amount: number;
  currency: string;
  methodBrand?: string;
  methodLast4?: string;
  failureMessage?: string;
}

export class WebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookError";
  }
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(request: CreatePaymentRequest): Promise<CreatedPayment>;
  /**
   * Checks a notification's signature and freshness and reads it. Throws
   * WebhookError when it cannot be trusted; nothing is acted on then.
   */
  verifyNotification(rawBody: string, headers: Headers): PaymentNotification;
}

// --- Mock provider ---------------------------------------------------------------

export const MOCK_SIGNATURE_HEADER = "x-mock-signature";
/** Notifications older than this are refused, so a captured one cannot be replayed later. */
const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export interface MockOutcome {
  outcome: "succeed" | "decline";
  providerPaymentId: string;
  amount: number;
  currency: string;
}

const sign = (secret: string, timestamp: number, body: string) =>
  createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface MockPaymentProvider extends PaymentProvider {
  /**
   * What the mock's "payment page" does when the shopper presses a button:
   * produces the signed notification a real provider would send.
   */
  notificationFor(outcome: MockOutcome, now?: number): { body: string; headers: Headers };
}

/**
 * Takes no money. Its payment page is part of this application
 * (/checkout/pay/...), and it signs notifications with a shared secret
 * exactly as a real provider would, so the webhook path is the real one.
 */
export function createMockPaymentProvider(options: { webhookSecret: string }): MockPaymentProvider {
  const { webhookSecret } = options;
  return {
    name: "mock",
    async createPayment(request) {
      const providerPaymentId = `mock_${randomUUID()}`;
      const query = new URLSearchParams({ payment: providerPaymentId, return: request.returnUrl });
      return { providerPaymentId, payUrl: `/checkout/pay?${query}` };
    },
    verifyNotification(rawBody, headers, now = Date.now()) {
      const header = headers.get(MOCK_SIGNATURE_HEADER) ?? "";
      const parts = Object.fromEntries(
        header.split(",").map((part) => part.trim().split("=", 2) as [string, string]),
      );
      const timestamp = Number(parts.t);
      if (!Number.isInteger(timestamp) || !parts.v1) {
        throw new WebhookError("missing or malformed signature");
      }
      if (Math.abs(now / 1000 - timestamp) > SIGNATURE_TOLERANCE_SECONDS) {
        throw new WebhookError("signature too old");
      }
      if (!safeEqual(parts.v1, sign(webhookSecret, timestamp, rawBody))) {
        throw new WebhookError("signature does not match");
      }
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        throw new WebhookError("body is not JSON");
      }
      const data = (event.data ?? {}) as Record<string, unknown>;
      if (
        typeof event.id !== "string" ||
        (event.type !== "payment.succeeded" && event.type !== "payment.failed") ||
        typeof data.payment !== "string" ||
        !Number.isInteger(data.amount) ||
        typeof data.currency !== "string"
      ) {
        throw new WebhookError("unexpected notification shape");
      }
      return {
        eventId: event.id,
        type: event.type,
        providerPaymentId: data.payment,
        amount: data.amount as number,
        currency: data.currency,
        ...(typeof data.brand === "string" ? { methodBrand: data.brand } : {}),
        ...(typeof data.last4 === "string" ? { methodLast4: data.last4 } : {}),
        ...(typeof data.failure === "string" ? { failureMessage: data.failure } : {}),
      };
    },
    notificationFor(outcome, now = Date.now()) {
      const body = JSON.stringify({
        id: `evt_${randomUUID()}`,
        type: outcome.outcome === "succeed" ? "payment.succeeded" : "payment.failed",
        data: {
          payment: outcome.providerPaymentId,
          amount: outcome.amount,
          currency: outcome.currency,
          ...(outcome.outcome === "succeed"
            ? { brand: "Test card", last4: "4242" }
            : { failure: "The card was declined (test)." }),
        },
      });
      const timestamp = Math.floor(now / 1000);
      const headers = new Headers({
        "content-type": "application/json",
        [MOCK_SIGNATURE_HEADER]: `t=${timestamp},v1=${sign(webhookSecret, timestamp, body)}`,
      });
      return { body, headers };
    },
  } as MockPaymentProvider;
}
