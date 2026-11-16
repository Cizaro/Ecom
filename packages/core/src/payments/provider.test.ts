import { describe, expect, it } from "vitest";
import { createMockPaymentProvider, MOCK_SIGNATURE_HEADER, WebhookError } from "./provider";

const provider = createMockPaymentProvider({ webhookSecret: "s".repeat(40) });
const outcome = {
  outcome: "succeed" as const,
  providerPaymentId: "mock_123",
  amount: 4990,
  currency: "USD",
};

describe("mock payment provider", () => {
  it("creates a payment with a page to pay on, never asking for card details", async () => {
    const payment = await provider.createPayment({
      orderId: "o1",
      amount: 4990,
      currency: "USD",
      returnUrl: "/order/o1?key=abc",
    });
    expect(payment.providerPaymentId).toMatch(/^mock_[0-9a-f-]{36}$/);
    expect(payment.payUrl).toMatch(/^\/checkout\/pay\?payment=mock_/);
  });

  it("accepts a correctly signed, fresh notification", () => {
    const { body, headers } = provider.notificationFor(outcome);
    expect(provider.verifyNotification(body, headers)).toMatchObject({
      type: "payment.succeeded",
      providerPaymentId: "mock_123",
      amount: 4990,
      currency: "USD",
      methodLast4: "4242",
    });
    const declined = provider.notificationFor({ ...outcome, outcome: "decline" });
    expect(provider.verifyNotification(declined.body, declined.headers)).toMatchObject({
      type: "payment.failed",
      failureMessage: expect.stringContaining("declined"),
    });
  });

  it("refuses anything it cannot trust", () => {
    const { body, headers } = provider.notificationFor(outcome);
    const attempts: [string, Headers][] = [
      // The body changed after signing (for example a bigger amount).
      [body.replace("4990", "1"), headers],
      // No signature at all, or a broken one.
      [body, new Headers()],
      [body, new Headers({ [MOCK_SIGNATURE_HEADER]: "nonsense" })],
      // Signed with another secret.
      ...[
        createMockPaymentProvider({ webhookSecret: "x".repeat(40) }).notificationFor(outcome),
      ].map((other) => [other.body, other.headers] as [string, Headers]),
      // Signed long ago: a replay.
      ...[provider.notificationFor(outcome, Date.now() - 60 * 60 * 1000)].map(
        (old) => [old.body, old.headers] as [string, Headers],
      ),
    ];
    for (const [rawBody, rawHeaders] of attempts) {
      expect(() => provider.verifyNotification(rawBody, rawHeaders)).toThrow(WebhookError);
    }
  });
});
