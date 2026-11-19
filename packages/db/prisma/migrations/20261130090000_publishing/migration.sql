-- AlterTable
ALTER TABLE "content_posts" ADD COLUMN     "auto_publish" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "platform_post_id" TEXT,
ADD COLUMN     "publish_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "publish_error" TEXT,
ADD COLUMN     "publishing_since" TIMESTAMPTZ(3);


-- Hand-written: rules the schema language cannot express.
ALTER TABLE content_posts
  ADD CONSTRAINT content_posts_publishing_valid CHECK (
    publish_attempts BETWEEN 0 AND 100
    AND (publish_error IS NULL OR char_length(publish_error) <= 500)
    AND (platform_post_id IS NULL OR (btrim(platform_post_id) <> '' AND char_length(platform_post_id) <= 100))
    AND (NOT auto_publish OR (planned_for IS NOT NULL AND channel IN ('instagram', 'facebook')))
  );
