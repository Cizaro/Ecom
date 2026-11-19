import { createHmac } from "node:crypto";
import type { SocialWebhookItem } from "./webhook";

// Meta's Graph API, through its official endpoints only (Milestone 6.3, D112):
// the sign-in exchange, the Pages a person manages with their linked Instagram
// accounts, and subscribing a Page to webhooks. Tokens travel in the
// Authorization header or a POST body, never in a logged address, and every
// call carries appsecret_proof. Tests and local runs without Meta use the
// fake below, which never calls out.

export const META_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_manage_metadata",
  "pages_manage_posts",
  "read_insights",
  "business_management",
  "instagram_basic",
  "instagram_manage_comments",
  "instagram_manage_messages",
  "instagram_content_publish",
  "instagram_manage_insights",
] as const;

/**
 * What the Page is subscribed to: Page activity (comments, posts), and
 * Messenger messages when pages_messaging was granted (Meta refuses the
 * messages field without it). Instagram messages and comments come through
 * the app's Instagram webhook subscription once the Page is subscribed.
 */
export function pageWebhookFields(grantedScopes: readonly string[]): string[] {
  return grantedScopes.includes("pages_messaging") ? ["feed", "messages"] : ["feed"];
}

/** A MetaError, also when the error object crossed a module boundary. */
export function isMetaError(error: unknown): error is MetaError {
  return error instanceof Error && error.name === "MetaError";
}

export class MetaError extends Error {
  constructor(
    message: string,
    /** Meta's own error code, when it gave one. */
    readonly code?: number,
  ) {
    super(message);
    this.name = "MetaError";
  }
}

export interface MetaPage {
  id: string;
  name: string;
  accessToken: string;
  /** What this person may do on the Page (MANAGE, MESSAGING, ...). */
  tasks: string[];
  instagram: { id: string; username: string | null } | null;
}

export interface MetaGraph {
  readonly mode: "live" | "fake";
  /** Where to send the person to sign in with Meta and grant access. */
  loginUrl(input: { redirectUri: string; state: string }): string;
  /** A long-lived user token from the code Meta returned. */
  userTokenFromCode(input: { code: string; redirectUri: string }): Promise<string>;
  grantedScopes(userToken: string): Promise<string[]>;
  listPages(userToken: string): Promise<MetaPage[]>;
  subscribePage(pageId: string, pageToken: string, fields: string[]): Promise<void>;
  unsubscribePage(pageId: string, pageToken: string): Promise<void>;
  /** Sends a direct message (Instagram or Messenger) from the Page; returns the message id. */
  sendMessage(input: {
    pageId: string;
    pageToken: string;
    recipientId: string;
    text: string;
  }): Promise<string>;
  /** Replies publicly under a comment; returns the new comment's id. */
  replyToComment(input: {
    channel: "instagram" | "facebook";
    commentId: string;
    pageToken: string;
    text: string;
  }): Promise<string>;
  /**
   * Recent Instagram messages and comments, read from the API: the backup for
   * notifications Meta did not send. Shaped like webhook items, with the same
   * keys, so an item already received is not stored twice.
   */
  recentInstagramItems(input: {
    pageId: string;
    instagramAccountId: string;
    pageToken: string;
  }): Promise<SocialWebhookItem[]>;
}

export interface MetaGraphConfig {
  appId: string;
  appSecret: string;
  /** Graph API version, e.g. "v23.0". */
  version: string;
  /** A Facebook Login for Business configuration; when absent, scopes are requested by name. */
  loginConfigId?: string;
  fetch?: typeof fetch;
}

const ID = /^[0-9]{1,30}$/;
const TIMEOUT_MS = 15_000;

function proof(token: string, appSecret: string): string {
  return createHmac("sha256", appSecret).update(token).digest("hex");
}

export function createMetaGraph(config: MetaGraphConfig): MetaGraph {
  if (!/^v\d{1,3}\.\d$/.test(config.version)) throw new Error("META_GRAPH_VERSION looks wrong");
  const doFetch = config.fetch ?? fetch;
  const base = `https://graph.facebook.com/${config.version}`;

  async function call(
    path: string,
    init: { method?: string; token?: string; params?: Record<string, string> } = {},
  ): Promise<Record<string, unknown>> {
    const params = new URLSearchParams(init.params);
    if (init.token) params.set("appsecret_proof", proof(init.token, config.appSecret));
    const method = init.method ?? "GET";
    const url = method === "GET" ? `${base}${path}?${params}` : `${base}${path}`;
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: {
          ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
          ...(method === "GET" ? {} : { "content-type": "application/x-www-form-urlencoded" }),
        },
        body: method === "GET" ? undefined : params.toString(),
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error",
      });
    } catch {
      throw new MetaError("Meta could not be reached. Try again in a minute.");
    }
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      // Handled below as an error without details.
    }
    if (!response.ok || body.error) {
      const error = (body.error ?? {}) as { message?: unknown; code?: unknown };
      const code = typeof error.code === "number" ? error.code : undefined;
      // Meta's message is shown to the store owner; it never contains our secrets.
      const detail = typeof error.message === "string" ? error.message.slice(0, 300) : "";
      throw new MetaError(detail ? `Meta said: ${detail}` : "Meta refused the request.", code);
    }
    return body;
  }

  async function exchange(params: Record<string, string>): Promise<string> {
    const body = await call("/oauth/access_token", {
      method: "POST",
      params: { client_id: config.appId, client_secret: config.appSecret, ...params },
    });
    if (typeof body.access_token !== "string" || !body.access_token) {
      throw new MetaError("Meta did not return an access token.");
    }
    return body.access_token;
  }

  return {
    mode: "live",
    loginUrl({ redirectUri, state }) {
      const params = new URLSearchParams({
        client_id: config.appId,
        redirect_uri: redirectUri,
        state,
        response_type: "code",
      });
      if (config.loginConfigId) params.set("config_id", config.loginConfigId);
      else params.set("scope", META_SCOPES.join(","));
      return `https://www.facebook.com/${config.version}/dialog/oauth?${params}`;
    },
    async userTokenFromCode({ code, redirectUri }) {
      const shortLived = await exchange({ code, redirect_uri: redirectUri });
      // Page tokens obtained with a long-lived user token do not expire.
      return exchange({ grant_type: "fb_exchange_token", fb_exchange_token: shortLived });
    },
    async grantedScopes(userToken) {
      const body = await call("/me/permissions", { token: userToken });
      const rows = Array.isArray(body.data) ? body.data : [];
      return rows
        .filter((row): row is { permission: string; status: string } => {
          const r = row as { permission?: unknown; status?: unknown };
          return typeof r.permission === "string" && r.status === "granted";
        })
        .map((row) => row.permission);
    },
    async listPages(userToken) {
      const body = await call("/me/accounts", {
        token: userToken,
        params: {
          fields: "id,name,access_token,tasks,instagram_business_account{id,username}",
          limit: "100",
        },
      });
      const rows = Array.isArray(body.data) ? body.data : [];
      const pages: MetaPage[] = [];
      for (const row of rows as Record<string, unknown>[]) {
        if (typeof row.id !== "string" || !ID.test(row.id)) continue;
        if (typeof row.access_token !== "string" || !row.access_token) continue;
        const ig = row.instagram_business_account as
          { id?: unknown; username?: unknown } | undefined;
        pages.push({
          id: row.id,
          name: typeof row.name === "string" && row.name.trim() ? row.name.slice(0, 200) : row.id,
          accessToken: row.access_token,
          tasks: Array.isArray(row.tasks) ? row.tasks.filter((t) => typeof t === "string") : [],
          instagram:
            ig && typeof ig.id === "string" && ID.test(ig.id)
              ? {
                  id: ig.id,
                  username:
                    typeof ig.username === "string" && /^[A-Za-z0-9._]{1,30}$/.test(ig.username)
                      ? ig.username
                      : null,
                }
              : null,
        });
      }
      return pages;
    },
    async subscribePage(pageId, pageToken, fields) {
      if (!ID.test(pageId)) throw new MetaError("That is not a Facebook Page.");
      if (fields.length === 0 || fields.some((f) => !/^[a-z_]{1,40}$/.test(f))) {
        throw new MetaError("No webhook fields to subscribe to.");
      }
      await call(`/${pageId}/subscribed_apps`, {
        method: "POST",
        token: pageToken,
        params: { subscribed_fields: fields.join(",") },
      });
    },
    async unsubscribePage(pageId, pageToken) {
      if (!ID.test(pageId)) return;
      await call(`/${pageId}/subscribed_apps`, { method: "DELETE", token: pageToken });
    },
    async sendMessage({ pageId, pageToken, recipientId, text }) {
      if (!ID.test(pageId) || !/^[0-9]{1,40}$/.test(recipientId)) {
        throw new MetaError("That conversation cannot be answered from here.");
      }
      const body = await call(`/${pageId}/messages`, {
        method: "POST",
        token: pageToken,
        params: {
          recipient: JSON.stringify({ id: recipientId }),
          message: JSON.stringify({ text }),
          messaging_type: "RESPONSE",
        },
      });
      return typeof body.message_id === "string" ? body.message_id : "";
    },
    async replyToComment({ channel, commentId, pageToken, text }) {
      if (!/^[0-9_]{1,80}$/.test(commentId))
        throw new MetaError("That comment cannot be answered.");
      const body = await call(`/${commentId}/${channel === "instagram" ? "replies" : "comments"}`, {
        method: "POST",
        token: pageToken,
        params: { message: text },
      });
      return typeof body.id === "string" ? body.id : "";
    },
    async recentInstagramItems({ pageId, instagramAccountId, pageToken }) {
      if (!ID.test(pageId) || !ID.test(instagramAccountId)) return [];
      const items: SocialWebhookItem[] = [];
      const conversations = await call(`/${pageId}/conversations`, {
        token: pageToken,
        params: {
          platform: "instagram",
          fields: "messages.limit(10){id,created_time,from,message}",
          limit: "10",
        },
      });
      for (const conversation of list(conversations.data)) {
        for (const message of list((conversation.messages as Record<string, unknown>)?.data)) {
          const from = (message.from ?? {}) as { id?: unknown; username?: unknown };
          if (typeof message.id !== "string" || typeof from.id !== "string") continue;
          // The shop's own messages (sent from Instagram or from here).
          if (from.id === instagramAccountId) continue;
          const at = Date.parse(String(message.created_time ?? ""));
          items.push({
            channel: "instagram",
            accountId: instagramAccountId,
            kind: "message",
            externalKey: `instagram:message:${message.id}`,
            occurredAt: Number.isNaN(at) ? null : new Date(at),
            payload: {
              sender: {
                id: from.id,
                username: typeof from.username === "string" ? from.username : undefined,
              },
              recipient: { id: instagramAccountId },
              timestamp: Number.isNaN(at) ? undefined : at,
              message: {
                mid: message.id,
                text: typeof message.message === "string" ? message.message : "",
              },
              source: "api",
            },
          });
        }
      }
      const media = await call(`/${instagramAccountId}/media`, {
        token: pageToken,
        params: {
          fields: "id,comments.limit(25){id,text,timestamp,username,from}",
          limit: "10",
        },
      });
      for (const post of list(media.data)) {
        for (const comment of list((post.comments as Record<string, unknown>)?.data)) {
          const from = (comment.from ?? {}) as { id?: unknown; username?: unknown };
          if (typeof comment.id !== "string") continue;
          if (from.id === instagramAccountId) continue;
          const at = Date.parse(String(comment.timestamp ?? ""));
          items.push({
            channel: "instagram",
            accountId: instagramAccountId,
            kind: "comment",
            externalKey: `instagram:comment:${comment.id}`,
            occurredAt: Number.isNaN(at) ? null : new Date(at),
            payload: {
              field: "comments",
              value: {
                id: comment.id,
                text: typeof comment.text === "string" ? comment.text : "",
                from: {
                  id: typeof from.id === "string" ? from.id : undefined,
                  username:
                    typeof from.username === "string"
                      ? from.username
                      : typeof comment.username === "string"
                        ? comment.username
                        : undefined,
                },
                media: { id: typeof post.id === "string" ? post.id : undefined },
              },
              source: "api",
            },
          });
        }
      }
      return items;
    },
  };
}

const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter((v): v is Record<string, unknown> => typeof v === "object" && v !== null)
    : [];

/** Pages the fake offers: one with Instagram linked, one without. */
export const FAKE_META_PAGES: readonly MetaPage[] = [
  {
    id: "100000000000001",
    name: "Test Shop Page",
    accessToken: "fake-page-token-1",
    tasks: ["MANAGE", "MESSAGING", "CREATE_CONTENT", "MODERATE"],
    instagram: { id: "17800000000000001", username: "testshop" },
  },
  {
    id: "100000000000002",
    name: "Second Test Page",
    accessToken: "fake-page-token-2",
    tasks: ["MANAGE"],
    instagram: null,
  },
];

export const FAKE_META_CODE = "fake-meta-code";

/**
 * A stand-in that never calls Meta: its sign-in goes straight back to our
 * own callback with a fixed code. For tests and for trying the screens
 * locally (META_GRAPH_MODE=fake); the launch check refuses it on a live site.
 */
export function createFakeMetaGraph(pages: readonly MetaPage[] = FAKE_META_PAGES): MetaGraph & {
  subscribed: Set<string>;
  sent: { kind: "message" | "comment"; to: string; text: string }[];
  /** Items the backup check returns next (tests add to it). */
  pending: SocialWebhookItem[];
  /** When set, sending fails with this message (tests). */
  failWith: string | null;
} {
  const subscribed = new Set<string>();
  const sent: { kind: "message" | "comment"; to: string; text: string }[] = [];
  const pending: SocialWebhookItem[] = [];
  const state = { failWith: null as string | null };
  let counter = 0;
  return {
    mode: "fake",
    subscribed,
    sent,
    pending,
    get failWith() {
      return state.failWith;
    },
    set failWith(value: string | null) {
      state.failWith = value;
    },
    loginUrl({ redirectUri, state }) {
      const url = new URL(redirectUri);
      url.searchParams.set("code", FAKE_META_CODE);
      url.searchParams.set("state", state);
      // A path on this same site, whatever host and port it is reached on.
      return `${url.pathname}${url.search}`;
    },
    async userTokenFromCode({ code }) {
      if (code !== FAKE_META_CODE) throw new MetaError("Meta said: invalid verification code.");
      return "fake-user-token";
    },
    async grantedScopes() {
      return [...META_SCOPES];
    },
    async listPages(userToken) {
      if (userToken !== "fake-user-token") throw new MetaError("Meta said: invalid token.", 190);
      return pages.map((page) => ({ ...page }));
    },
    async subscribePage(pageId) {
      subscribed.add(pageId);
    },
    async unsubscribePage(pageId) {
      subscribed.delete(pageId);
    },
    async sendMessage({ recipientId, text }) {
      if (state.failWith) throw new MetaError(`Meta said: ${state.failWith}`);
      sent.push({ kind: "message", to: recipientId, text });
      return `fake-mid-${Date.now()}-${++counter}`;
    },
    async replyToComment({ commentId, text }) {
      if (state.failWith) throw new MetaError(`Meta said: ${state.failWith}`);
      sent.push({ kind: "comment", to: commentId, text });
      return `900${Date.now()}${++counter}`;
    },
    async recentInstagramItems() {
      return pending.splice(0, pending.length);
    },
  };
}

/**
 * The Graph client the settings ask for (web app and worker alike): the
 * stand-in for META_GRAPH_MODE=fake, null when the Meta app is not set up.
 */
export function metaGraphFromSettings(env: {
  META_APP_ID?: string;
  META_APP_SECRET?: string;
  META_WEBHOOK_VERIFY_TOKEN?: string;
  META_GRAPH_MODE: "live" | "fake";
  META_GRAPH_VERSION: string;
  META_LOGIN_CONFIG_ID?: string;
}): MetaGraph | null {
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_WEBHOOK_VERIFY_TOKEN) return null;
  if (env.META_GRAPH_MODE === "fake") return createFakeMetaGraph();
  return createMetaGraph({
    appId: env.META_APP_ID,
    appSecret: env.META_APP_SECRET,
    version: env.META_GRAPH_VERSION,
    loginConfigId: env.META_LOGIN_CONFIG_ID,
  });
}
