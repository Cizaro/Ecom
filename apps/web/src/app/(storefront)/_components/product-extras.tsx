"use client";

import { buttonClasses } from "@ecom/ui";
import { useEffect, useState } from "react";
import { RECENT_COOKIE, RECENT_COOKIE_DAYS, withRecent } from "@/server/recently-viewed";

/**
 * Notes this product in the visitor's own browser so later pages can show a
 * "recently viewed" strip. Only product URL names are kept, in a first-party
 * cookie; nothing identifies the visitor. Renders nothing.
 */
export function RememberProduct({ slug }: { slug: string }) {
  useEffect(() => {
    const current = document.cookie
      .split("; ")
      .find((part) => part.startsWith(`${RECENT_COOKIE}=`))
      ?.slice(RECENT_COOKIE.length + 1);
    const secure = window.location.protocol === "https:" ? "; secure" : "";
    document.cookie =
      `${RECENT_COOKIE}=${withRecent(current, slug)}; path=/; samesite=lax` +
      `; max-age=${RECENT_COOKIE_DAYS * 24 * 60 * 60}${secure}`;
  }, [slug]);
  return null;
}

/**
 * Shares the page with the device's own share sheet where there is one, and
 * otherwise copies the address. Hidden until the browser can do either.
 */
export function ShareButton({ title }: { title: string }) {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    setReady(typeof navigator.share === "function" || !!navigator.clipboard);
  }, []);
  if (!ready) return null;

  async function share() {
    // The address without the chosen colour or size would lose the selection,
    // so the current address is shared as it is.
    const url = window.location.href;
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setMessage("Link copied.");
    } catch {
      // Closing the share sheet is not an error worth reporting.
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <button type="button" onClick={share} className={buttonClasses("secondary")}>
        Share
      </button>
      <span role="status" className="text-sm text-ink-muted">
        {message}
      </span>
    </div>
  );
}
