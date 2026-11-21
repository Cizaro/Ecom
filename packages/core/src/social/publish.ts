import { featureProblem } from "../tenancy/plan-limits";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { assertPermission, NotFoundError, type RequestContext } from "../access/context";
import { audit, type TenantDb } from "../access/tenant-db";
import { recordAudit } from "../platform/audit";
import { openSecret } from "../platform/secret-box";
import type { StorageProvider } from "../storage/storage";
import { PAGE_TOKEN_PURPOSE } from "./connections";
import { isMetaError, type MetaGraph } from "./meta-graph";

// Publishing approved posts to Instagram and Facebook (Milestone 6.5,
// decision D114). Only posts that went through approval can be published,
// by staff with social.publish: now, or automatically at the planned time.
// Photo posts (one photo or a carousel of 2 to 10) are published through
// Meta; reels, stories and videos stay "post by hand" for now. Each photo is
// sent as a JPEG copy at a public address (Meta downloads it), checked
// against Instagram's shape limits first. A publish is claimed before it
// starts, so it never happens twice; a failure keeps Meta's reason, and an
// automatic publish is tried at most three times.

export interface PublishDeps {
  graph: MetaGraph;
  encryptionKey: string;
  storage: Pick<StorageProvider, "get" | "put" | "publicUrl">;
}

export class PublishError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublishError";
  }
}

export const MAX_AUTO_ATTEMPTS = 3;
const CLAIM_MINUTES = 10;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Why the app cannot publish this post itself, or null when it can. */
export function publishBlocker(post: {
  channel: string;
  format: string;
  files: { kind: string }[];
}): string | null {
  if (post.channel !== "instagram" && post.channel !== "facebook") {
    return "Only Instagram and Facebook posts are published by the app; post this one by hand.";
  }
  if (post.format === "reel" || post.format === "story") {
    return "Reels and stories are posted by hand for now.";
  }
  if (post.files.length === 0) return "Add at least one photo from the library.";
  if (post.files.some((file) => file.kind !== "image")) {
    return "Videos are posted by hand for now; use photos only.";
  }
  if (post.files.length > 10) return "Use 10 photos at most.";
  return null;
}

/** A JPEG copy of a library photo at a public address, made once per photo. */
async function publicJpeg(
  storage: PublishDeps["storage"],
  storageKey: string,
  instagram: boolean,
): Promise<string> {
  const folder = storageKey.slice(0, storageKey.lastIndexOf("/"));
  if (!folder.startsWith("public/")) throw new PublishError("That photo is not stored publicly.");
  const original = await storage.get(storageKey);
  const image = sharp(original, { failOn: "error" }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;
  if (!width || !height) throw new PublishError("A photo could not be read.");
  const ratio = width / height;
  if (instagram && (ratio < 0.8 || ratio > 1.91)) {
    throw new PublishError(
      "A photo's shape is outside what Instagram accepts (from 4:5 tall to 1.91:1 wide). Make a version sized for Instagram in the library (Sizes and versions).",
    );
  }
  const body = await image
    .resize({ width: 1440, height: 1800, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  const name = createHash("sha256").update(body).digest("hex").slice(0, 16);
  const key = `${folder}/social-${name}.jpg`;
  await storage.put(key, body, { contentType: "image/jpeg" });
  return storage.publicUrl(key);
}

type Actor = RequestContext | null;

async function runPublish(
  db: TenantDb,
  deps: PublishDeps,
  postId: string,
  actor: Actor,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  const now = new Date();
  // Claim it: approved, and not being published right now by someone else.
  const claimed = await db.run(async (tx) => {
    const post = await tx.contentPost.findUnique({
      where: { id: postId },
      select: {
        id: true,
        status: true,
        channel: true,
        format: true,
        caption: true,
        publishingSince: true,
        publishAttempts: true,
        assets: {
          orderBy: { position: "asc" },
          select: { asset: { select: { media: { select: { storageKey: true, kind: true } } } } },
        },
      },
    });
    if (!post) throw new NotFoundError("post");
    if (post.status !== "approved") {
      throw new PublishError("Only approved posts can be published. Reload the page.");
    }
    if (
      post.publishingSince &&
      now.getTime() - post.publishingSince.getTime() < CLAIM_MINUTES * 60_000
    ) {
      throw new PublishError("This post is being published right now.");
    }
    await tx.contentPost.update({
      where: { id: post.id },
      data: { publishingSince: now, publishAttempts: { increment: 1 } },
    });
    const connection = await tx.socialConnection.findFirst({
      where: { provider: "meta" },
      select: {
        pageId: true,
        instagramAccountId: true,
        accessTokenEncrypted: true,
        status: true,
      },
    });
    return { post, connection };
  });
  const { post, connection } = claimed;
  const files = post.assets.map(({ asset }) => asset.media);

  let error: string | null = null;
  let result: { id: string; url: string | null } | null = null;
  const blocker = publishBlocker({ channel: post.channel, format: post.format, files });
  const token = connection
    ? openSecret(deps.encryptionKey, PAGE_TOKEN_PURPOSE, connection.accessTokenEncrypted)
    : null;
  if (blocker) error = blocker;
  else if (!post.caption.trim()) error = "Write a caption first.";
  else if (!connection || !token || connection.status !== "active") {
    error = "Instagram and Facebook are not connected (or need connecting again).";
  } else if (post.channel === "instagram" && !connection.instagramAccountId) {
    error = "No Instagram account is linked to the connected Facebook Page.";
  } else {
    try {
      const instagram = post.channel === "instagram";
      const imageUrls: string[] = [];
      for (const file of files)
        imageUrls.push(await publicJpeg(deps.storage, file.storageKey, instagram));
      result = instagram
        ? await deps.graph.publishInstagram({
            instagramAccountId: connection.instagramAccountId!,
            pageToken: token,
            imageUrls,
            caption: post.caption,
          })
        : await deps.graph.publishFacebook({
            pageId: connection.pageId,
            pageToken: token,
            imageUrls,
            caption: post.caption,
          });
    } catch (caught) {
      error =
        caught instanceof PublishError || isMetaError(caught)
          ? caught.message
          : "The post could not be published. Try again in a minute.";
    }
  }

  const attempts = post.publishAttempts + 1;
  await db.run(async (tx) => {
    await tx.contentPost.update({
      where: { id: post.id },
      data: result
        ? {
            status: "published",
            publishedAt: new Date(),
            publishedUrl: result.url,
            platformPostId: result.id.slice(0, 100),
            publishError: null,
            publishingSince: null,
            autoPublish: false,
          }
        : {
            publishError: (error ?? "Unknown error").slice(0, 500),
            publishingSince: null,
            ...(attempts >= MAX_AUTO_ATTEMPTS ? { autoPublish: false } : {}),
          },
    });
    const action = result ? "content.post_published_to_meta" : "content.post_publish_failed";
    const after: { [key: string]: string | null } = result
      ? { channel: post.channel, platformPostId: result.id, url: result.url }
      : { channel: post.channel, error: (error ?? "").slice(0, 200) };
    if (actor) {
      await audit(tx, actor, action, { type: "content_post", id: post.id }, undefined, after);
    } else {
      await recordAudit(tx, {
        tenantId: db.tenantId,
        actorType: "system",
        actorUserId: null,
        action,
        entityType: "content_post",
        entityId: post.id,
        after,
      });
    }
  });
  return result ? { ok: true, url: result.url } : { ok: false, error: error ?? "Unknown error" };
}

/** Publishes an approved post now (social.publish). */
export async function publishPostNow(
  db: TenantDb,
  context: RequestContext,
  deps: PublishDeps,
  postId: string,
): Promise<{ ok: true; url: string | null } | { ok: false; error: string }> {
  assertPermission(context, "social.publish");
  if (!UUID.test(postId)) throw new NotFoundError("post");
  return runPublish(db, deps, postId, context);
}

/** Turns automatic publishing at the planned time on or off (social.publish). */
export async function setAutoPublish(
  db: TenantDb,
  context: RequestContext,
  postId: string,
  on: boolean,
): Promise<void> {
  assertPermission(context, "social.publish");
  if (!UUID.test(postId)) throw new NotFoundError("post");
  await db.run(async (tx) => {
    const post = await tx.contentPost.findUnique({
      where: { id: postId },
      select: {
        status: true,
        channel: true,
        format: true,
        plannedFor: true,
        assets: { select: { asset: { select: { media: { select: { kind: true } } } } } },
      },
    });
    if (!post) throw new NotFoundError("post");
    if (on) {
      const notIncluded = await featureProblem(tx, "scheduled_posts");
      if (notIncluded) throw new PublishError(notIncluded);
      if (post.status !== "approved") {
        throw new PublishError("Only approved posts can be scheduled.");
      }
      const blocker = publishBlocker({
        channel: post.channel,
        format: post.format,
        files: post.assets.map(({ asset }) => asset.media),
      });
      if (blocker) throw new PublishError(blocker);
      if (!post.plannedFor) throw new PublishError("Set the planned date and time first.");
    }
    await tx.contentPost.update({
      where: { id: postId },
      // A fresh schedule gets fresh tries.
      data: on
        ? { autoPublish: true, publishAttempts: 0, publishError: null }
        : { autoPublish: false },
    });
    await audit(
      tx,
      context,
      on ? "content.post_scheduled" : "content.post_unscheduled",
      { type: "content_post", id: postId },
      undefined,
      { plannedFor: post.plannedFor?.toISOString() ?? null },
    );
  });
}

/** Publishes the store's scheduled posts whose time has come (worker). */
export async function publishDuePosts(
  db: TenantDb,
  deps: PublishDeps,
  now = new Date(),
): Promise<{ published: number; failed: number }> {
  // A shop whose plan no longer includes scheduling keeps its posts; they
  // wait until the plan includes it again or someone publishes them by hand.
  if (await db.run((tx) => featureProblem(tx, "scheduled_posts"))) {
    return { published: 0, failed: 0 };
  }
  const due = await db.run((tx) =>
    tx.contentPost.findMany({
      where: {
        status: "approved",
        autoPublish: true,
        plannedFor: { lte: now },
        publishAttempts: { lt: MAX_AUTO_ATTEMPTS },
        OR: [
          { publishingSince: null },
          { publishingSince: { lt: new Date(now.getTime() - CLAIM_MINUTES * 60_000) } },
        ],
      },
      orderBy: { plannedFor: "asc" },
      select: { id: true },
      take: 10,
    }),
  );
  const counts = { published: 0, failed: 0 };
  for (const post of due) {
    try {
      const outcome = await runPublish(db, deps, post.id, null);
      if (outcome.ok) counts.published += 1;
      else counts.failed += 1;
    } catch (error) {
      if (error instanceof PublishError) counts.failed += 1;
      else throw error;
    }
  }
  return counts;
}
