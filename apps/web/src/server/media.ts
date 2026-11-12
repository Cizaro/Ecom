import "server-only";

import { getEnv } from "@ecom/config";
import {
  CatalogError,
  createLogger,
  createS3Storage,
  enqueueMediaProcessing,
  imageView,
  MAX_UPLOAD_BYTES,
  type ImageView,
  type MediaDeps,
  type StorageProvider,
  type StoredImage,
} from "@ecom/core";

// Uploaded files for the web app: the storage connection, what the upload
// services need, and reading an image out of a submitted form.

const globalForMedia = globalThis as typeof globalThis & { __storage?: StorageProvider };

export function getStorage(): StorageProvider {
  globalForMedia.__storage ??= createS3Storage(getEnv());
  return globalForMedia.__storage;
}

export function mediaDeps(): MediaDeps {
  const env = getEnv();
  return {
    storage: getStorage(),
    enqueueProcessing: (job) => enqueueMediaProcessing(env.REDIS_URL, job),
    onWarning: (message, detail) => createLogger("web", env.LOG_LEVEL).warn(detail, message),
  };
}

/** Addresses for an <img>, from a stored image. */
export function viewOf(image: StoredImage): ImageView {
  return imageView(getStorage(), image);
}

/**
 * The image file submitted in a form field. Only the size is checked here;
 * the upload service decides from the file's content whether it is an image.
 */
export async function uploadedImage(formData: FormData, name = "image"): Promise<Uint8Array> {
  const file = formData.get(name);
  if (!(file instanceof File) || file.size === 0) {
    throw new CatalogError("invalid_image", "Choose an image file to upload.", name);
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new CatalogError(
      "image_too_large",
      `The image is too large. The limit is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB.`,
      name,
    );
  }
  return new Uint8Array(await file.arrayBuffer());
}
