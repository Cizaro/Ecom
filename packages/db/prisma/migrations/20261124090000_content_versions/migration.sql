-- AlterTable
ALTER TABLE "content_assets" ADD COLUMN     "derived_from_id" UUID,
ADD COLUMN     "edit_note" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "content_assets_derived_from_id_idx" ON "content_assets"("derived_from_id");

-- AddForeignKey
ALTER TABLE "content_assets" ADD CONSTRAINT "content_assets_derived_from_id_fkey" FOREIGN KEY ("derived_from_id") REFERENCES "content_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: rules the schema language cannot express.
ALTER TABLE content_assets
  ADD CONSTRAINT content_assets_not_own_version CHECK (derived_from_id IS NULL OR derived_from_id <> id),
  ADD CONSTRAINT content_assets_edit_note_valid CHECK (char_length(edit_note) <= 500);

CREATE TRIGGER content_assets_derived_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, derived_from_id ON content_assets
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('content_assets', 'derived_from_id');
