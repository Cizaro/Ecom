import { describe, expect, it } from "vitest";
import { totpCode, totpSecretFromUri } from "./totp";

// RFC 6238 appendix B test vectors (SHA-1, secret "12345678901234567890"),
// truncated from 8 digits to our 6.
// This is the public test key from the RFC, not a credential.
const SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"; // gitleaks:allow

describe("totpCode", () => {
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
  ])("matches the RFC 6238 vector at t=%i", (seconds, expected) => {
    expect(totpCode(SECRET, seconds * 1000)).toBe(expected);
  });

  it("reads the secret from an otpauth URI", () => {
    expect(totpSecretFromUri(`otpauth://totp/App:me?secret=${SECRET}&issuer=App`)).toBe(SECRET);
  });
});
