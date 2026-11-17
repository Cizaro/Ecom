-- AlterTable
ALTER TABLE "stores" ADD COLUMN     "logo_asset_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "stores_logo_asset_id_key" ON "stores"("logo_asset_id");

-- AddForeignKey
ALTER TABLE "stores" ADD CONSTRAINT "stores_logo_asset_id_fkey" FOREIGN KEY ("logo_asset_id") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Hand-written: the logo belongs to the store's own tenant.
CREATE TRIGGER stores_logo_same_tenant
  BEFORE INSERT OR UPDATE OF tenant_id, logo_asset_id ON stores
  FOR EACH ROW EXECUTE FUNCTION app_private.check_same_tenant('media_assets', 'logo_asset_id');

ALTER TABLE stores
  ADD CONSTRAINT stores_name_valid CHECK (btrim(name) <> '' AND char_length(name) <= 100),
  ADD CONSTRAINT stores_timezone_length CHECK (char_length(timezone) <= 64);
