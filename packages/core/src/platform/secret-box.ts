import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

// Encrypts secrets kept in the database or in a cookie (a social Page's access
// token, a sign-in in progress). AES-256-GCM with a key derived from
// ENCRYPTION_KEY for one purpose, so a value sealed for one use cannot be
// opened as another. Format: "v1:" + base64url(iv | tag | ciphertext).

const VERSION = "v1:";

function keyFor(secret: string, purpose: string): Buffer {
  if (secret.length < 32) throw new Error("secret-box: ENCRYPTION_KEY is too short");
  const salt = createHash("sha256").update("ecom-secret-box").digest();
  return Buffer.from(hkdfSync("sha256", secret, salt, purpose, 32));
}

export function sealSecret(secret: string, purpose: string, plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(secret, purpose), iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return VERSION + Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

/** The plaintext, or null when the value was changed, sealed for another purpose or with another key. */
export function openSecret(secret: string, purpose: string, sealed: string): string | null {
  if (typeof sealed !== "string" || !sealed.startsWith(VERSION)) return null;
  const raw = Buffer.from(sealed.slice(VERSION.length), "base64url");
  if (raw.length < 12 + 16) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", keyFor(secret, purpose), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
