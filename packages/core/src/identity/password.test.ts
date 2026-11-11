import { describe, expect, it } from "vitest";
import { hashPassword, passwordProblem, verifyPassword } from "./password";

describe("hashPassword / verifyPassword", () => {
  it("produces an Argon2id PHC string and verifies the same password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+$/);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects a different password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery stapl")).toBe(false);
    expect(await verifyPassword(hash, "")).toBe(false);
  });

  it("salts: the same password hashes differently each time", async () => {
    const [first, second] = await Promise.all([hashPassword("same"), hashPassword("same")]);
    expect(first).not.toBe(second);
    expect(await verifyPassword(first, "same")).toBe(true);
    expect(await verifyPassword(second, "same")).toBe(true);
  });

  it("handles non-ASCII passwords", async () => {
    const hash = await hashPassword("pässwörd-كلمة-🔑");
    expect(await verifyPassword(hash, "pässwörd-كلمة-🔑")).toBe(true);
    expect(await verifyPassword(hash, "password-كلمة-🔑")).toBe(false);
  });

  it("returns false, never throws, for values that are not our hashes", async () => {
    for (const value of ["", "plain-text", "$2b$10$abcdefghijklmnopqrstuv", "$argon2id$v=19$bad"]) {
      expect(await verifyPassword(value, "anything")).toBe(false);
    }
  });

  it("refuses hashes whose parameters would exhaust memory", async () => {
    const hostile = "$argon2id$v=19$m=999999999,t=2,p=1$c2FsdHNhbHRzYWx0$aGFzaGhhc2hoYXNo";
    expect(await verifyPassword(hostile, "anything")).toBe(false);
  });
});

describe("passwordProblem", () => {
  it("accepts 10 to 128 characters", () => {
    expect(passwordProblem("a".repeat(10))).toBeNull();
    expect(passwordProblem("a".repeat(128))).toBeNull();
  });

  it("explains what is wrong otherwise", () => {
    expect(passwordProblem("a".repeat(9))).toMatch(/at least 10/);
    expect(passwordProblem("a".repeat(129))).toMatch(/at most 128/);
  });
});
