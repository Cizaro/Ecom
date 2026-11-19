import { getEnv } from "@ecom/config";
import {
  createLogger,
  createTenantDb,
  findSocialConnection,
  parseMetaWebhook,
  recordSocialWebhookItems,
  verifyMetaSignature,
  verifyMetaSubscription,
  type SocialWebhookItem,
} from "@ecom/core";
import { getAppPrisma } from "@ecom/db";

// Where Meta sends notifications about connected Pages and Instagram
// accounts (Milestone 6.3, D112). Public by design: GET answers Meta's
// subscription check only with the right verify token; POST acts only on a
// body signed with the App Secret (X-Hub-Signature-256), checked before
// anything is read. Items are stored once each inside the store that owns
// the Page or account; anything for an unknown account is ignored.
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 256 * 1024;

export async function GET(request: Request): Promise<Response> {
  const env = getEnv();
  const challenge = verifyMetaSubscription(
    new URL(request.url).searchParams,
    env.META_WEBHOOK_VERIFY_TOKEN,
  );
  if (challenge === null) return new Response(null, { status: 403 });
  return new Response(challenge, { headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: Request): Promise<Response> {
  const env = getEnv();
  if (!env.META_APP_SECRET) return new Response(null, { status: 404 });
  const length = Number(request.headers.get("content-length") ?? "0");
  if (length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_BYTES) return new Response(null, { status: 413 });
  // Signed with the App Secret, or with the Instagram app secret for the
  // Instagram webhooks configured under "API setup with Instagram login".
  const signature = request.headers.get("x-hub-signature-256");
  const secrets = [env.META_APP_SECRET, env.META_INSTAGRAM_APP_SECRET].filter(
    (secret): secret is string => Boolean(secret),
  );
  if (!secrets.some((secret) => verifyMetaSignature(rawBody, signature, secret))) {
    return new Response(null, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return Response.json({ received: false }, { status: 400 });
  }

  const groups = new Map<string, SocialWebhookItem[]>();
  for (const item of parseMetaWebhook(body)) {
    const key = `${item.channel}:${item.accountId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const logger = createLogger("web", env.LOG_LEVEL);
  for (const items of groups.values()) {
    const { channel, accountId } = items[0]!;
    const owner = await findSocialConnection(env.DATABASE_ADMIN_URL, channel, accountId);
    if (!owner) continue;
    try {
      const stored = await recordSocialWebhookItems(
        createTenantDb(getAppPrisma(env.DATABASE_URL), { tenantId: owner.tenantId }),
        owner.connectionId,
        items,
      );
      logger.info({ tenantId: owner.tenantId, channel, stored }, "meta webhook stored");
    } catch (error) {
      // Answer with an error so Meta sends the notification again later.
      logger.error(
        { tenantId: owner.tenantId, err: (error as Error).message },
        "meta webhook failed",
      );
      return new Response(null, { status: 500 });
    }
  }
  return Response.json({ received: true });
}
