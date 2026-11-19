import { createHmac } from "node:crypto";

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

/** What the Page is subscribed to: Page messages and Page activity (comments, posts). */
export const PAGE_WEBHOOK_FIELDS = ["messages", "feed"] as const;

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
  subscribePage(pageId: string, pageToken: string): Promise<void>;
  unsubscribePage(pageId: string, pageToken: string): Promise<void>;
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
    async subscribePage(pageId, pageToken) {
      if (!ID.test(pageId)) throw new MetaError("That is not a Facebook Page.");
      await call(`/${pageId}/subscribed_apps`, {
        method: "POST",
        token: pageToken,
        params: { subscribed_fields: PAGE_WEBHOOK_FIELDS.join(",") },
      });
    },
    async unsubscribePage(pageId, pageToken) {
      if (!ID.test(pageId)) return;
      await call(`/${pageId}/subscribed_apps`, { method: "DELETE", token: pageToken });
    },
  };
}

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
export function createFakeMetaGraph(
  pages: readonly MetaPage[] = FAKE_META_PAGES,
): MetaGraph & { subscribed: Set<string> } {
  const subscribed = new Set<string>();
  return {
    mode: "fake",
    subscribed,
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
  };
}
