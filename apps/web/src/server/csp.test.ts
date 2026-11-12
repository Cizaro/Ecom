import { describe, expect, it } from "vitest";
import { buildCsp, createNonce, originOf } from "./csp";

const directive = (csp: string, name: string) =>
  csp
    .split("; ")
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(" ");

describe("content security policy", () => {
  it("makes a fresh, unguessable nonce each time", () => {
    const nonces = new Set(Array.from({ length: 50 }, createNonce));
    expect(nonces.size).toBe(50);
    for (const nonce of nonces) expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it("allows scripts only with the nonce in production", () => {
    const csp = buildCsp("abc", { development: false });
    expect(directive(csp, "script-src")).toEqual(["'self'", "'nonce-abc'", "'strict-dynamic'"]);
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("ws:");
    expect(directive(csp, "object-src")).toEqual(["'none'"]);
    expect(directive(csp, "frame-ancestors")).toEqual(["'none'"]);
    expect(directive(csp, "form-action")).toEqual(["'self'"]);
  });

  it("allows images from the media origin and nowhere else", () => {
    const without = buildCsp("abc", { development: false });
    expect(directive(without, "img-src")).toEqual(["'self'", "data:", "blob:"]);

    const origin = originOf("https://media.example.com/bucket/path");
    expect(origin).toBe("https://media.example.com");
    const csp = buildCsp("abc", { development: false, mediaOrigin: origin });
    expect(directive(csp, "img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://media.example.com",
    ]);
    // Only images: scripts and connections stay limited to this site.
    expect(directive(csp, "script-src")).not.toContain("https://media.example.com");
    expect(directive(csp, "connect-src")).toEqual(["'self'"]);
  });

  it("ignores a media address that is missing or not a web address", () => {
    expect(originOf(undefined)).toBeNull();
    expect(originOf("")).toBeNull();
    expect(originOf("not a url")).toBeNull();
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("data:text/html,x")).toBeNull();
  });

  it("relaxes only what the development server needs", () => {
    const csp = buildCsp("abc", { development: true });
    expect(directive(csp, "script-src")).toContain("'unsafe-eval'");
    expect(directive(csp, "connect-src")).toContain("ws:");
  });
});
