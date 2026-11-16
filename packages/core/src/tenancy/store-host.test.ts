import { describe, expect, it } from "vitest";
import { normalizeHost, storefrontRequestHost } from "./store-host";

describe("which host a storefront request is for", () => {
  it("is the Host header for requests to a store domain, whatever else is sent", () => {
    expect(storefrontRequestHost("shop.example.com", null)).toBe("shop.example.com");
    // A request to one store cannot ask to be treated as another.
    expect(storefrontRequestHost("shop.example.com", "other-store.example.com")).toBe(
      "shop.example.com",
    );
  });

  it("follows X-Forwarded-Host only for requests from this machine", () => {
    // Next.js renders the page after a redirect with a request to its own localhost address.
    expect(storefrontRequestHost("localhost:3000", "shop.example.com")).toBe("shop.example.com");
    expect(storefrontRequestHost("127.0.0.1:3000", "a.example.com, b.example.com")).toBe(
      "a.example.com",
    );
    expect(storefrontRequestHost("[::1]:3000", "shop.example.com")).toBe("shop.example.com");
    expect(storefrontRequestHost("localhost:3000", null)).toBe("localhost:3000");
    expect(storefrontRequestHost("localhost.example.com", "shop.example.com")).toBe(
      "localhost.example.com",
    );
  });

  it("gives nothing when there is no host", () => {
    expect(storefrontRequestHost(null, "shop.example.com")).toBeNull();
    expect(storefrontRequestHost("  ", null)).toBeNull();
  });
});

describe("host names", () => {
  it("are compared without case, port or trailing dot", () => {
    expect(normalizeHost("Shop.Example.COM.:443")).toBe("shop.example.com");
    expect(normalizeHost("[::1]:3000")).toBeNull();
    expect(normalizeHost("bad host")).toBeNull();
  });
});
