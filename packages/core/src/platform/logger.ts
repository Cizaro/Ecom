import pino from "pino";

export type Logger = pino.Logger;

/** Fields that must never reach the logs, at the top level or one level down. */
const SENSITIVE_KEYS = [
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "secret",
  "authorization",
  "cookie",
  "cardNumber",
];

const REDACTED_PATHS = [
  ...SENSITIVE_KEYS.flatMap((key) => [key, `*.${key}`]),
  "*.headers.authorization",
  "*.headers.cookie",
];

/**
 * Structured JSON logger. `name` identifies the process or module.
 * `destination` is for tests; by default logs go to stdout.
 */
export function createLogger(
  name: string,
  level: string = "info",
  destination?: pino.DestinationStream,
): Logger {
  const options: pino.LoggerOptions = {
    name,
    level,
    redact: { paths: REDACTED_PATHS, censor: "[redacted]" },
    timestamp: pino.stdTimeFunctions.isoTime,
  };
  return destination ? pino(options, destination) : pino(options);
}
