import { getEnv } from "@ecom/config";
import { getSocialConnection, pageChoices, recentSocialEvents, type PageChoice } from "@ecom/core";
import { Alert, Badge, Card, PageHeader } from "@ecom/ui";
import type { Metadata } from "next";
import { requirePermission, tenantDb } from "@/server/access";
import { getMetaGraph, metaConfigured, pendingToken } from "@/server/social";
import { ActionForm } from "../../_components/form";
import { ConnectMetaForm } from "./connect-form";
import { choosePageAction, connectMetaAction, disconnectMetaAction } from "./actions";

export const metadata: Metadata = { title: "Instagram and Facebook" };

type Params = Record<string, string | string[] | undefined>;

const ERRORS: Record<string, string> = {
  "not-configured": "Meta is not set up for this installation yet (see docs/META_SETUP.md).",
  cancelled: "The Meta sign-in was cancelled. Nothing was connected.",
  expired: "That Meta sign-in had expired or did not start here. Connect again.",
  "no-pages":
    "Your Facebook profile manages no Page we can connect. Make sure you are an admin of the shop's Page, then connect again.",
  "page-taken": "That Page or its Instagram account is already connected to another store.",
  meta: "Meta refused the request. Connect again; if it keeps failing, check the app in Meta for Developers.",
};

const when = new Intl.DateTimeFormat("en", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Beirut",
});

// The store's Facebook Page and Instagram account (Milestone 6.3, D112):
// connect through Meta's own sign-in, see what is connected and what Meta
// has sent lately, disconnect. Owners only (social.connect).
export default async function SocialPage({ searchParams }: { searchParams: Promise<Params> }) {
  const { context } = await requirePermission("social.connect");
  const params = await searchParams;
  const db = tenantDb(context);
  const connection = await getSocialConnection(db, context);
  const events = connection ? await recentSocialEvents(db, context, 10) : [];
  const graph = getMetaGraph();
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;

  let choices: PageChoice[] | null = null;
  let choiceError: string | null = null;
  if (params.choose === "1" && graph) {
    const token = await pendingToken(context);
    if (!token) choiceError = "Your Meta sign-in has expired. Connect again.";
    else {
      try {
        choices = pageChoices(await graph.listPages(token));
      } catch {
        choiceError = "Meta did not list your Pages. Connect again.";
      }
    }
  }
  const webhookUrl = new URL("/api/webhooks/meta", getEnv().APP_URL).toString();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Instagram and Facebook"
        description="Connect the shop's Facebook Page and the Instagram account linked to it, so messages and comments can reach the admin. You sign in on Meta's own site; your Facebook password never comes here."
      />
      {graph?.mode === "fake" ? (
        <Alert tone="warning" testId="meta-fake-mode">
          Test mode: this installation does not talk to Meta (META_GRAPH_MODE=fake). The Pages below
          are examples.
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}
      {choiceError ? <Alert tone="error">{choiceError}</Alert> : null}
      {params.connected === "1" && connection ? (
        <Alert tone="success" testId="meta-connected-notice">
          Connected to {connection.pageName}.
        </Alert>
      ) : null}

      {params.disconnected === "1" && !connection ? (
        <Alert tone="success" testId="meta-disconnected-notice">
          Disconnected. Meta no longer sends this store anything.
        </Alert>
      ) : null}

      {!metaConfigured() ? (
        <Card title="Not set up yet">
          <p className="text-sm">
            The Meta app&apos;s keys are missing from this installation&apos;s settings. Follow
            docs/META_SETUP.md, put META_APP_ID, META_APP_SECRET and META_WEBHOOK_VERIFY_TOKEN in
            the settings, and restart.
          </p>
        </Card>
      ) : null}

      {choices ? (
        <Card title="Choose the shop's Page">
          <ul className="flex flex-col gap-3" data-testid="meta-pages">
            {choices.map((page) => (
              <li
                key={page.id}
                className="flex flex-col gap-2 rounded-card border border-line p-3 text-sm"
                data-testid="meta-page"
              >
                <span className="font-medium">{page.name}</span>
                <span className="text-ink-muted">
                  {page.hasInstagram
                    ? `Instagram: ${page.instagramUsername ? `@${page.instagramUsername}` : "linked"}`
                    : "No Instagram account linked to this Page"}
                </span>
                {page.canConnect ? (
                  <ActionForm action={choosePageAction} submitLabel="Connect this Page">
                    <input type="hidden" name="pageId" value={page.id} />
                  </ActionForm>
                ) : (
                  <span className="text-ink-muted">
                    Your role on this Page cannot manage messages.
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {connection ? (
        <Card title="Connected">
          <dl className="grid gap-2 text-sm sm:grid-cols-[12rem_1fr]" data-testid="meta-connection">
            <dt className="text-ink-muted">Facebook Page</dt>
            <dd className="font-medium">{connection.pageName}</dd>
            <dt className="text-ink-muted">Instagram</dt>
            <dd>
              {connection.instagramAccountId
                ? connection.instagramUsername
                  ? `@${connection.instagramUsername}`
                  : "Linked"
                : "Not linked to this Page. Link it in the Page's settings, then connect again."}
            </dd>
            <dt className="text-ink-muted">Status</dt>
            <dd>
              {connection.status === "active" ? (
                <Badge tone="success">Working</Badge>
              ) : (
                <Badge tone="warning">Connect again</Badge>
              )}
            </dd>
            <dt className="text-ink-muted">Connected</dt>
            <dd>{when.format(connection.connectedAt)}</dd>
            <dt className="text-ink-muted">Last notification from Meta</dt>
            <dd>{connection.lastWebhookAt ? when.format(connection.lastWebhookAt) : "None yet"}</dd>
            <dt className="text-ink-muted">Permissions granted</dt>
            <dd>{connection.scopes.length ? connection.scopes.join(", ") : "Unknown"}</dd>
          </dl>
          {events.length > 0 ? (
            <ul className="mt-4 flex flex-col gap-1 text-sm" data-testid="meta-events">
              {events.map((event) => (
                <li key={event.id}>
                  {when.format(event.receivedAt)}: {event.channel} {event.kind}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-4">
            <ActionForm
              action={disconnectMetaAction}
              submitLabel="Disconnect"
              submitTone="danger"
              testId="meta-disconnect"
            />
          </div>
        </Card>
      ) : null}

      {metaConfigured() ? (
        <Card title={connection ? "Connect a different Page" : "Connect"}>
          <ConnectMetaForm action={connectMetaAction}>
            <p className="text-sm">
              You will sign in with Facebook, choose the shop&apos;s Page (and its Instagram
              account), and allow access to messages, comments, posts and their statistics. You can
              remove access at any time here or in Facebook&apos;s settings.
            </p>
          </ConnectMetaForm>
        </Card>
      ) : null}

      {metaConfigured() ? (
        <Card title="For Meta for Developers (webhooks)">
          <p className="text-sm">
            In the app&apos;s Webhooks settings, for both Page and Instagram, use this callback
            address and the verify token from META_WEBHOOK_VERIFY_TOKEN in the settings. Meta needs
            a public https address: on a computer without one, notifications start once the site is
            online.
          </p>
          <p className="mt-2 break-all font-mono text-xs" data-testid="meta-webhook-url">
            {webhookUrl}
          </p>
        </Card>
      ) : null}
    </div>
  );
}
