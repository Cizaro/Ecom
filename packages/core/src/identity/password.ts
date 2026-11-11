import { argon2, randomBytes, timingSafeEqual } from "node:crypto";

// Argon2id via Node's built-in implementation, stored in the standard PHC
// string format so parameters can be raised later without breaking old hashes.
// Parameters follow the OWASP minimum recommendation (19 MiB, 2 passes).
const MEMORY_KIB = 19_456;
const PASSES = 2;
const PARALLELISM = 1;
const SALT_BYTES = 16;
const TAG_BYTES = 32;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Returns a problem description, or null when the password is acceptable. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  }
  return null;
}

function derive(
  password: string,
  salt: Buffer,
  memory: number,
  passes: number,
  parallelism: number,
  tagLength: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    argon2(
      "argon2id",
      {
        message: Buffer.from(password, "utf8"),
        nonce: salt,
        memory,
        passes,
        parallelism,
        tagLength,
      },
      (error, key) => (error ? reject(error) : resolve(key)),
    );
  });
}

const b64 = (buffer: Buffer) => buffer.toString("base64").replace(/=+$/, "");

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const tag = await derive(password, salt, MEMORY_KIB, PASSES, PARALLELISM, TAG_BYTES);
  return `$argon2id$v=19$m=${MEMORY_KIB},t=${PASSES},p=${PARALLELISM}$${b64(salt)}$${b64(tag)}`;
}

const PHC = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

/** False for a wrong password and for anything that is not one of our hashes. */
export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  const match = PHC.exec(hash);
  if (!match) return false;
  const [, memory, passes, parallelism, saltText, tagText] = match;
  const salt = Buffer.from(saltText!, "base64");
  const expected = Buffer.from(tagText!, "base64");
  // Refuse absurd parameters rather than let a tampered hash exhaust memory.
  if (Number(memory) > 1_048_576 || Number(passes) > 20 || Number(parallelism) > 16) return false;
  try {
    const actual = await derive(
      password,
      salt,
      Number(memory),
      Number(passes),
      Number(parallelism),
      expected.length,
    );
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
