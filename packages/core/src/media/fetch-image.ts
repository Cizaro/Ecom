import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { MAX_UPLOAD_BYTES, sniffImageType } from "./image";

// Downloads a picture from a link a staff member typed (product import).
// Fetching a URL from the server is a classic way to reach things that
// should be private (server-side request forgery), so this:
//
// - accepts only http and https links without user names or passwords, on
//   the normal ports;
// - looks up the host itself and refuses private, loopback, link-local and
//   other non-public addresses, and connects to exactly the address it
//   checked (so a second lookup cannot point somewhere else);
// - follows at most three redirects, checking each one the same way;
// - gives up after a time limit, and stops reading past the size limit;
// - accepts only bytes that really are a JPEG, PNG or WebP image.

export class ImageFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageFetchError";
  }
}

export interface FetchImageOptions {
  /** Tests only: allow private addresses and any port (a local test server). */
  allowPrivateHosts?: boolean;
  timeoutMs?: number;
  maxBytes?: number;
}

const MAX_REDIRECTS = 3;

/** Whether an IP address is on the public internet. */
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b] = address.split(".").map(Number) as [number, number];
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local, cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false; // 192.0.0.0/24 and 192.0.2.0/24
    if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
    if (a === 198 && b === 51) return false; // documentation
    if (a === 203 && b === 0) return false; // documentation
    if (a >= 224) return false; // multicast and reserved
    return true;
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    if (lower === "::" || lower === "::1") return false;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPublicAddress(mapped[1]!);
    if (/^f[cd]/.test(lower)) return false; // unique local
    if (/^fe[89ab]/.test(lower)) return false; // link-local
    if (/^ff/.test(lower)) return false; // multicast
    if (lower.startsWith("2001:db8")) return false; // documentation
    if (lower.startsWith("64:ff9b:")) return false; // NAT64, could reach private IPv4
    return true;
  }
  return false;
}

/** A DNS lookup for http(s).request that refuses non-public answers. */
function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) {
        callback(error, "", 0);
        return;
      }
      const list = addresses as unknown as LookupAddress[];
      const bad = list.find((entry) => !allowPrivate && !isPublicAddress(entry.address));
      if (bad || list.length === 0) {
        callback(new ImageFetchError("The picture link points to a private address."), "", 0);
        return;
      }
      // Connect to the first checked address only.
      const chosen = list[0]!;
      if ((options as { all?: boolean }).all) {
        (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, [chosen]);
      } else {
        callback(null, chosen.address, chosen.family);
      }
    });
  };
}

function checkUrl(raw: string, allowPrivate: boolean): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImageFetchError("The picture link is not a web address.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ImageFetchError("Picture links must start with https:// or http://.");
  }
  if (url.username || url.password) {
    throw new ImageFetchError("Picture links cannot contain a user name or password.");
  }
  if (!allowPrivate && url.port && url.port !== "80" && url.port !== "443") {
    throw new ImageFetchError("Picture links must use the normal web ports.");
  }
  // A literal IP address is checked directly (no lookup happens for it).
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!allowPrivate && isIP(host) && !isPublicAddress(host)) {
    throw new ImageFetchError("The picture link points to a private address.");
  }
  if (!allowPrivate && (host === "localhost" || host.endsWith(".localhost"))) {
    throw new ImageFetchError("The picture link points to a private address.");
  }
  return url;
}

function getOnce(
  url: URL,
  options: Required<FetchImageOptions>,
): Promise<{ redirect?: string; body?: Uint8Array }> {
  return new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.get(
      url,
      {
        lookup: guardedLookup(options.allowPrivateHosts),
        headers: { "user-agent": "store-product-import/1.0", accept: "image/*" },
        timeout: options.timeoutMs,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location) {
          response.resume();
          resolve({ redirect: new URL(response.headers.location, url).toString() });
          return;
        }
        if (status !== 200) {
          response.resume();
          reject(new ImageFetchError(`The picture link answered with status ${status}.`));
          return;
        }
        const declared = Number(response.headers["content-length"] ?? 0);
        if (declared > options.maxBytes) {
          response.destroy();
          reject(new ImageFetchError("The picture is too large (8 MB at most)."));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > options.maxBytes) {
            response.destroy();
            reject(new ImageFetchError("The picture is too large (8 MB at most)."));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () => resolve({ body: new Uint8Array(Buffer.concat(chunks)) }));
        response.on("error", reject);
      },
    );
    request.on("timeout", () => {
      request.destroy(new ImageFetchError("The picture link took too long to answer."));
    });
    request.on("error", (error) => {
      reject(
        error instanceof ImageFetchError
          ? error
          : new ImageFetchError("The picture could not be downloaded from its link."),
      );
    });
  });
}

/** Downloads an image from a link, safely. Throws ImageFetchError with a message for staff. */
export async function fetchImageFromUrl(
  raw: string,
  options: FetchImageOptions = {},
): Promise<Uint8Array> {
  const settings: Required<FetchImageOptions> = {
    allowPrivateHosts: options.allowPrivateHosts ?? false,
    timeoutMs: options.timeoutMs ?? 15_000,
    maxBytes: options.maxBytes ?? MAX_UPLOAD_BYTES,
  };
  let url = checkUrl(raw, settings.allowPrivateHosts);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const result = await getOnce(url, settings);
    if (result.body) {
      if (!sniffImageType(result.body)) {
        throw new ImageFetchError("The picture link did not give a JPEG, PNG or WebP image.");
      }
      return result.body;
    }
    url = checkUrl(result.redirect!, settings.allowPrivateHosts);
  }
  throw new ImageFetchError("The picture link redirected too many times.");
}
