import "server-only";

import { getEnv } from "@ecom/config";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { requestHostName } from "./area";

// The platform site (D121): the public pages that sell the platform, on
// PLATFORM_HOST only. The proxy sends that host's requests here; this check
// makes sure the same pages never answer on a shop's address.

async function hostOfRequest(): Promise<string | null> {
  const h = await headers();
  return requestHostName(h.get("host"), h.get("x-forwarded-host"));
}

/** For every platform-site page and action: 404 unless reached on the platform's host. */
export async function requirePlatformSite(): Promise<void> {
  if ((await hostOfRequest()) !== getEnv().PLATFORM_HOST.toLowerCase()) notFound();
}

const isLocal = (host: string) => host === "localhost" || host.endsWith(".localhost");

/** The full address of a host on this installation (http and the app's port on a development computer). */
export function addressOf(hostname: string): string {
  if (!isLocal(hostname)) return `https://${hostname}`;
  const port = new URL(getEnv().APP_URL).port;
  return `http://${hostname}${port ? `:${port}` : ""}`;
}

/** The address of a host as the visitor reached this site (keeps the port they used). */
export async function visitorAddressOf(hostname: string): Promise<string> {
  const raw = (await headers()).get("host") ?? "";
  const port = isLocal(hostname) ? raw.match(/:(\d+)$/)?.[1] : undefined;
  return port ? `http://${hostname}:${port}` : addressOf(hostname);
}
