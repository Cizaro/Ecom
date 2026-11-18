import { describe, expect, it } from "vitest";
import { clientAddressFrom } from "./client-address";

describe("visitor address for rate limits", () => {
  it("takes the entry our proxy added, not one the visitor wrote", () => {
    // The visitor sent "1.2.3.4"; our one proxy appended the real address.
    expect(clientAddressFrom("1.2.3.4, 203.0.113.9", 1)).toBe("203.0.113.9");
    expect(clientAddressFrom("1.2.3.4, 198.51.100.7, 203.0.113.9", 2)).toBe("198.51.100.7");
  });

  it("ignores the header when no proxy is trusted, or when it is missing or odd", () => {
    expect(clientAddressFrom("203.0.113.9", 0)).toBe("unknown");
    expect(clientAddressFrom(null, 1)).toBe("unknown");
    expect(clientAddressFrom("  ", 1)).toBe("unknown");
    expect(clientAddressFrom("not an address<script>", 1)).toBe("unknown");
  });

  it("accepts IPv6 and falls back to the first entry when there are fewer than the hops", () => {
    expect(clientAddressFrom("2001:db8::1", 1)).toBe("2001:db8::1");
    expect(clientAddressFrom("203.0.113.9", 3)).toBe("203.0.113.9");
  });
});
