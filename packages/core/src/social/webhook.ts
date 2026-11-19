import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Meta's webhook notifications (Milestone 6.3, D112): checking that a
// notification really comes from Meta, and splitting it into one item per
// message or comment, each with the platform's own identifier so a resent
// notification is stored once.

/** Checks X-Hub-Signature-256 ("sha256=<hex>"), the HMAC of the raw body with the app secret. */
export function verifyMetaSignature(
  rawBody: string,
  header: string | null,
  appSecret: string,
): boolean {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const given = Buffer.from(header.slice("sha256=".length), "hex");
  const expected = createHmac("sha256", appSecret).update(rawBody, "utf8").digest();
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Answers Meta's subscription check: the challenge when the token matches, otherwise null. */
export function verifyMetaSubscription(
  params: URLSearchParams,
  verifyToken: string | undefined,
): string | null {
  if (!verifyToken || params.get("hub.mode") !== "subscribe") return null;
  const given = Buffer.from(params.get("hub.verify_token") ?? "");
  const expected = Buffer.from(verifyToken);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const challenge = params.get("hub.challenge") ?? "";
  return /^[A-Za-z0-9_-]{1,200}$/.test(challenge) ? challenge : null;
}

export type SocialChannel = "facebook" | "instagram";
export type SocialEventKind = "message" | "comment" | "other";

export interface SocialWebhookItem {
  channel: SocialChannel;
  /** The Page ID (facebook) or Instagram account ID the notification is for. */
  accountId: string;
  kind: SocialEventKind;
  externalKey: string;
  occurredAt: Date | null;
  payload: Record<string, unknown>;
}

const ID = /^[0-9]{1,30}$/;
const KEY_PART = /^[A-Za-z0-9_.:=-]{1,200}$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const hashOf = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 40);

function when(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    // Messaging timestamps are milliseconds, entry times seconds.
    const date = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  return null;
}

/** One item per message or comment; anything unrecognised is kept as "other". */
export function parseMetaWebhook(body: unknown): SocialWebhookItem[] {
  if (!isObject(body)) return [];
  const channel: SocialChannel | null =
    body.object === "page" ? "facebook" : body.object === "instagram" ? "instagram" : null;
  if (!channel || !Array.isArray(body.entry)) return [];
  const items: SocialWebhookItem[] = [];
  for (const entry of body.entry.slice(0, 100)) {
    if (!isObject(entry) || typeof entry.id !== "string" || !ID.test(entry.id)) continue;
    const accountId = entry.id;
    const entryTime = when(entry.time);
    const messaging = Array.isArray(entry.messaging) ? entry.messaging.slice(0, 100) : [];
    for (const event of messaging) {
      if (!isObject(event)) continue;
      const message = isObject(event.message) ? event.message : null;
      const mid = message && typeof message.mid === "string" ? message.mid : null;
      const kind: SocialEventKind = mid ? "message" : "other";
      items.push({
        channel,
        accountId,
        kind,
        externalKey:
          mid && KEY_PART.test(mid)
            ? `${channel}:message:${mid}`
            : `${channel}:other:${hashOf(event)}`,
        occurredAt: when(event.timestamp) ?? entryTime,
        payload: event,
      });
    }
    const changes = Array.isArray(entry.changes) ? entry.changes.slice(0, 100) : [];
    for (const change of changes) {
      if (!isObject(change) || !isObject(change.value)) continue;
      const value = change.value;
      let key: string | null = null;
      if (channel === "facebook" && change.field === "feed" && value.item === "comment") {
        const id = value.comment_id;
        const verb = typeof value.verb === "string" ? value.verb : "add";
        if (typeof id === "string" && KEY_PART.test(id) && KEY_PART.test(verb)) {
          key = `facebook:comment:${id}:${verb}`;
        }
      } else if (channel === "instagram" && change.field === "comments") {
        if (typeof value.id === "string" && KEY_PART.test(value.id)) {
          key = `instagram:comment:${value.id}`;
        }
      }
      items.push({
        channel,
        accountId,
        kind: key ? "comment" : "other",
        externalKey: key ?? `${channel}:other:${hashOf(change)}`,
        occurredAt: when(value.created_time) ?? entryTime,
        payload: { field: change.field, value },
      });
    }
  }
  return items;
}
