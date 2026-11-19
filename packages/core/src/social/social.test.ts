import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { openSecret, sealSecret } from "../platform/secret-box";
import { createFakeMetaGraph, createMetaGraph, FAKE_META_CODE, MetaError } from "./meta-graph";
import { pageChoices } from "./connections";
import { parseMetaWebhook, verifyMetaSignature, verifyMetaSubscription } from "./webhook";

const KEY = "k".repeat(40);
const APP_SECRET = "0123456789abcdef0123456789abcdef";

describe("secret box", () => {
  it("opens what it sealed, for the same purpose and key only", () => {
    const sealed = sealSecret(KEY, "a", "page-token-123");
    expect(sealed.startsWith("v1:")).toBe(true);
    expect(sealed).not.toContain("page-token");
    expect(openSecret(KEY, "a", sealed)).toBe("page-token-123");
    expect(openSecret(KEY, "b", sealed)).toBeNull();
    expect(openSecret("x".repeat(40), "a", sealed)).toBeNull();
    expect(sealSecret(KEY, "a", "same")).not.toBe(sealSecret(KEY, "a", "same"));
  });

  it("refuses a changed or malformed value", () => {
    const sealed = sealSecret(KEY, "a", "secret");
    const flipped = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(openSecret(KEY, "a", flipped)).toBeNull();
    expect(openSecret(KEY, "a", "v1:abc")).toBeNull();
    expect(openSecret(KEY, "a", "plain")).toBeNull();
  });
});

describe("Meta webhook checks", () => {
  const body = JSON.stringify({ object: "page", entry: [] });
  const sign = (raw: string, secret = APP_SECRET) =>
    `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;

  it("accepts only a body signed with the App Secret", () => {
    expect(verifyMetaSignature(body, sign(body), APP_SECRET)).toBe(true);
    expect(verifyMetaSignature(body + " ", sign(body), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body, "f".repeat(32)), APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, null, APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, "sha1=abc", APP_SECRET)).toBe(false);
    expect(verifyMetaSignature(body, sign(body), "")).toBe(false);
  });

  it("answers the subscription check only with the right token", () => {
    const params = (token: string, challenge = "1158201444") =>
      new URLSearchParams({
        "hub.mode": "subscribe",
        "hub.verify_token": token,
        "hub.challenge": challenge,
      });
    expect(verifyMetaSubscription(params("right-token-1234567"), "right-token-1234567")).toBe(
      "1158201444",
    );
    expect(verifyMetaSubscription(params("wrong"), "right-token-1234567")).toBeNull();
    expect(verifyMetaSubscription(params("right-token-1234567"), undefined)).toBeNull();
    expect(
      verifyMetaSubscription(params("right-token-1234567", "<script>"), "right-token-1234567"),
    ).toBeNull();
  });
});

describe("parseMetaWebhook", () => {
  it("splits Page messages and comments with stable keys", () => {
    const items = parseMetaWebhook({
      object: "page",
      entry: [
        {
          id: "100000000000001",
          time: 1_790_000_000,
          messaging: [
            {
              sender: { id: "555" },
              recipient: { id: "100000000000001" },
              timestamp: 1_790_000_000_123,
              message: { mid: "m_abc-123", text: "Is the black tote in stock?" },
            },
          ],
          changes: [
            {
              field: "feed",
              value: { item: "comment", verb: "add", comment_id: "123_456", message: "Price?" },
            },
          ],
        },
      ],
    });
    expect(items.map((i) => [i.channel, i.kind, i.externalKey])).toEqual([
      ["facebook", "message", "facebook:message:m_abc-123"],
      ["facebook", "comment", "facebook:comment:123_456:add"],
    ]);
    expect(items[0]!.occurredAt?.getTime()).toBe(1_790_000_000_123);
    expect(items[0]!.accountId).toBe("100000000000001");
  });

  it("reads Instagram comments and keeps unknown changes as other", () => {
    const items = parseMetaWebhook({
      object: "instagram",
      entry: [
        {
          id: "17800000000000001",
          changes: [
            { field: "comments", value: { id: "1799", text: "Love it" } },
            { field: "mentions", value: { media_id: "1" } },
          ],
        },
      ],
    });
    expect(items.map((i) => i.kind)).toEqual(["comment", "other"]);
    expect(items[0]!.externalKey).toBe("instagram:comment:1799");
    expect(items[1]!.externalKey).toMatch(/^instagram:other:[0-9a-f]{40}$/);
  });

  it("ignores what is not a Meta notification", () => {
    expect(parseMetaWebhook(null)).toEqual([]);
    expect(parseMetaWebhook({ object: "user", entry: [{ id: "1" }] })).toEqual([]);
    expect(parseMetaWebhook({ object: "page", entry: [{ id: "not-a-number" }] })).toEqual([]);
  });
});

describe("Meta Graph client", () => {
  function recorder(responses: Record<string, unknown>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const path = new URL(url).pathname.replace(/^\/v23\.0/, "");
      const body = responses[`${init.method} ${path}`] ?? { error: { message: "unknown" } };
      return new Response(JSON.stringify(body), {
        status: (body as { error?: unknown }).error ? 400 : 200,
      });
    }) as unknown as typeof fetch;
    return { calls, fetchFn };
  }

  it("asks for permissions by name, or with a login configuration", () => {
    const base = { appId: "1414532210811508", appSecret: APP_SECRET, version: "v23.0" };
    const byScope = new URL(
      createMetaGraph(base).loginUrl({ redirectUri: "https://a.example/cb", state: "s1" }),
    );
    expect(byScope.host).toBe("www.facebook.com");
    expect(byScope.searchParams.get("scope")).toContain("instagram_manage_messages");
    expect(byScope.searchParams.get("state")).toBe("s1");
    const byConfig = new URL(
      createMetaGraph({ ...base, loginConfigId: "998877" }).loginUrl({
        redirectUri: "https://a.example/cb",
        state: "s1",
      }),
    );
    expect(byConfig.searchParams.get("config_id")).toBe("998877");
    expect(byConfig.searchParams.get("scope")).toBeNull();
  });

  it("keeps tokens and the secret out of addresses and proves the app secret", async () => {
    const { calls, fetchFn } = recorder({
      "POST /oauth/access_token": { access_token: "user-token-xyz" },
      "GET /me/accounts": {
        data: [
          {
            id: "100000000000001",
            name: "Shop",
            access_token: "page-token",
            tasks: ["MANAGE"],
            instagram_business_account: { id: "17800000000000001", username: "shop" },
          },
          { id: "bad", name: "Ignored", access_token: "x" },
        ],
      },
    });
    const graph = createMetaGraph({
      appId: "1414532210811508",
      appSecret: APP_SECRET,
      version: "v23.0",
      fetch: fetchFn,
    });
    const token = await graph.userTokenFromCode({ code: "c", redirectUri: "https://a.example/cb" });
    const pages = await graph.listPages(token);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.instagram).toEqual({ id: "17800000000000001", username: "shop" });
    for (const call of calls) {
      expect(call.url).not.toContain(APP_SECRET);
      expect(call.url).not.toContain("user-token-xyz");
    }
    const list = calls.find((c) => c.url.includes("/me/accounts"))!;
    expect(new Headers(list.init.headers).get("authorization")).toBe("Bearer user-token-xyz");
    expect(new URL(list.url).searchParams.get("appsecret_proof")).toBe(
      createHmac("sha256", APP_SECRET).update("user-token-xyz").digest("hex"),
    );
  });

  it("reports Meta's refusal as a MetaError", async () => {
    const { fetchFn } = recorder({});
    const graph = createMetaGraph({
      appId: "1",
      appSecret: APP_SECRET,
      version: "v23.0",
      fetch: fetchFn,
    });
    await expect(graph.listPages("t")).rejects.toBeInstanceOf(MetaError);
  });

  it("the fake goes straight back to our callback and never calls out", async () => {
    const fake = createFakeMetaGraph();
    const path = fake.loginUrl({ redirectUri: "http://localhost:3000/cb", state: "s" });
    expect(path.startsWith("/cb?")).toBe(true);
    const url = new URL(path, "http://localhost");
    expect(url.searchParams.get("code")).toBe(FAKE_META_CODE);
    const token = await fake.userTokenFromCode({ code: FAKE_META_CODE, redirectUri: "" });
    const choices = pageChoices(await fake.listPages(token));
    expect(choices.map((c) => [c.name, c.hasInstagram, c.canConnect])).toEqual([
      ["Test Shop Page", true, true],
      ["Second Test Page", false, true],
    ]);
    await expect(fake.userTokenFromCode({ code: "other", redirectUri: "" })).rejects.toThrow();
  });
});

describe("pageWebhookFields", () => {
  it("asks for Messenger messages only when pages_messaging was granted", async () => {
    const { pageWebhookFields } = await import("./meta-graph");
    expect(pageWebhookFields(["pages_manage_metadata"])).toEqual(["feed"]);
    expect(pageWebhookFields(["pages_messaging"])).toEqual(["feed", "messages"]);
  });
});
