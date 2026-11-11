import { createHmac } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  let bits = "";
  for (const char of clean) {
    const value = ALPHABET.indexOf(char);
    if (value < 0) throw new Error("Invalid base32 character");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes = bits.match(/.{8}/g) ?? [];
  return Buffer.from(bytes.map((byte) => parseInt(byte, 2)));
}

/**
 * Time-based one-time password (RFC 6238: HMAC-SHA1, 30-second step, 6 digits),
 * as an authenticator app would compute it. For tests only.
 */
export function totpCode(secretBase32: string, atMs: number = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(atMs / 1000 / 30)));
  const digest = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = digest.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 1_000_000).padStart(6, "0");
}

/** Reads the shared secret out of an otpauth:// URI. */
export function totpSecretFromUri(uri: string): string {
  const secret = new URL(uri).searchParams.get("secret");
  if (!secret) throw new Error("No secret in TOTP URI");
  return secret;
}
