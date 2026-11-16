import { describe, expect, it } from "vitest";
import type { OrderView } from "../orders/orders";
import {
  orderCancelledEmail,
  orderConfirmationEmail,
  orderShippedEmail,
  paymentReceivedEmail,
  staffLowStockEmail,
  staffNewOrderEmail,
} from "./order-emails";
import { NotificationSettingsError, parseAddressList } from "./settings";

const store = { name: "Cedar Bags", url: "https://cedar.example.test" };
const url = "https://cedar.example.test/order/1?key=abc";

const order = (overrides: Partial<OrderView> = {}): OrderView => ({
  id: "00000000-0000-4000-8000-000000000001",
  number: 1042,
  status: "confirmed",
  paymentMethod: "cash_on_delivery",
  email: "maya@example.test",
  customerId: null,
  currency: "USD",
  subtotalAmount: 4000,
  shippingAmount: 300,
  taxAmount: 0,
  discountAmount: 0,
  totalAmount: 4300,
  refundedAmount: 0,
  discountCode: null,
  shippingAddress: {
    fullName: "Maya Khoury",
    phone: "+961 71 000 111",
    line1: "Armenia Street 12",
    line2: null,
    city: "Beirut",
    region: null,
    postalCode: null,
    country: "LB",
  },
  shippingZoneName: "Beirut",
  taxRateBasisPoints: 0,
  taxIncludedAmount: 0,
  taxLabel: null,
  placedAt: new Date("2026-11-17T10:00:00Z"),
  paidAt: null,
  payBy: new Date("2026-12-17T10:00:00Z"),
  shipment: null,
  items: [
    {
      id: "i1",
      productName: "Leather Tote",
      sku: "TOTE-1",
      color: "Sand",
      size: null,
      quantity: 1,
      unitPriceAmount: 4000,
      lineTotalAmount: 4000,
    },
  ],
  payments: [],
  returns: [],
  ...overrides,
});

describe("shopper emails", () => {
  it("confirm a cash order with the amount to pay and the delivery fee", () => {
    const mail = orderConfirmationEmail(order(), store, url);
    expect(mail.to).toBe("maya@example.test");
    expect(mail.subject).toBe("Order #1042 confirmed: Cedar Bags");
    expect(mail.text).toContain("Delivery (Beirut): $3.00");
    expect(mail.text).toContain("To pay the courier in cash: $43.00");
    expect(mail.text).toContain(url);
  });

  it("say an order is on its way with exactly the tracking staff entered", () => {
    const sent = order({
      status: "fulfilled",
      shipment: {
        courier: "Toters",
        trackingReference: "TT-77",
        trackingUrl: "https://track.example.test/TT-77",
        shippedAt: new Date(),
      },
    });
    const mail = orderShippedEmail(sent, store, url);
    expect(mail.subject).toBe("Order #1042 is on its way: Cedar Bags");
    expect(mail.text).toContain("Courier: Toters");
    expect(mail.text).toContain("Tracking number: TT-77");
    expect(mail.text).toContain("Track your parcel: https://track.example.test/TT-77");
    expect(mail.text).toContain("Please have $43.00 in cash ready for the courier.");
    // No delivery date is promised.
    expect(mail.text).not.toMatch(/arrive (on|by|within)/i);
  });

  it("leave out tracking lines that were not given, and the cash line once paid", () => {
    const mail = orderShippedEmail(
      order({
        paymentMethod: "online",
        status: "fulfilled",
        shipment: {
          courier: null,
          trackingReference: null,
          trackingUrl: null,
          shippedAt: new Date(),
        },
      }),
      store,
      url,
    );
    expect(mail.text).not.toContain("Courier:");
    expect(mail.text).not.toContain("in cash");
  });

  it("confirm cash received and explain a cancellation", () => {
    expect(paymentReceivedEmail(order(), store, url).text).toContain(
      "We have received your payment of $43.00.",
    );
    expect(orderCancelledEmail(order(), store, url, "expired").text).toContain(
      "because the payment was not completed in time",
    );
    const staff = orderCancelledEmail(order(), store, url, "staff");
    expect(staff.subject).toBe("Order #1042 cancelled: Cedar Bags");
    expect(staff.text).toContain("Nothing was charged.");
  });

  it("keep the subject on one line whatever the store is called", () => {
    const mail = orderConfirmationEmail(order(), { ...store, name: "Evil\r\nBcc: x@y.z" }, url);
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});

describe("staff emails", () => {
  it("give staff what they need to prepare a new order", () => {
    const mail = staffNewOrderEmail(
      order(),
      store,
      "https://admin.example.test/admin/orders/1",
      "staff@example.test",
    );
    expect(mail.to).toBe("staff@example.test");
    expect(mail.subject).toBe("New order #1042: $43.00, cash on delivery");
    expect(mail.text).toContain("Phone: +961 71 000 111");
    expect(mail.text).toContain("Delivery area: Beirut");
    expect(mail.text).toContain("https://admin.example.test/admin/orders/1");
  });

  it("warn about low stock and sold-out products", () => {
    const item = {
      variantId: "v1",
      productName: "Leather Tote",
      sku: "TOTE-1",
      color: "Sand",
      size: null,
      available: 2,
    };
    const low = staffLowStockEmail(item, store, "https://a.test/x", "stock@example.test");
    expect(low.subject).toBe("Low stock: Leather Tote (Sand), TOTE-1");
    expect(low.text).toContain("has 2 left to sell");
    expect(
      staffLowStockEmail({ ...item, available: 0 }, store, "https://a.test/x", "s@e.test").subject,
    ).toBe("Sold out: Leather Tote (Sand), TOTE-1");
  });
});

describe("staff address lists", () => {
  it("are read from commas, spaces or lines, lowercased, once each", () => {
    expect(parseAddressList(" A@Example.test, b@example.test\na@example.test ", "x")).toEqual([
      "a@example.test",
      "b@example.test",
    ]);
    expect(parseAddressList("", "x")).toEqual([]);
  });

  it("refuse anything that is not an address, and more than five", () => {
    expect(() => parseAddressList("not-an-email", "x")).toThrow(NotificationSettingsError);
    expect(() =>
      parseAddressList("a@e.test b@e.test c@e.test d@e.test e@e.test f@e.test", "x"),
    ).toThrow(/up to 5/);
  });
});
