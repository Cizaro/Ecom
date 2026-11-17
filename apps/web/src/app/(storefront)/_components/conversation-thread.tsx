import type { ConversationView } from "@ecom/core";
import { Alert } from "@ecom/ui";
import { replyToConversationAction } from "../support/actions";
import { AccountForm, AccountTextArea } from "./account-form";

/** A conversation as the shopper sees it, with a reply box. Internal notes never reach here. */
export function ConversationThread({
  conversation,
  accessKey,
  justSent,
}: {
  conversation: ConversationView;
  accessKey?: string;
  justSent: boolean;
}) {
  const when = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight" data-testid="conversation-subject">
          {conversation.subject}
        </h1>
        <p className="text-sm text-ink-muted">
          {conversation.order ? `About order #${conversation.order.number} · ` : ""}
          {conversation.status === "closed"
            ? "Closed. Write again to reopen it."
            : conversation.status === "waiting"
              ? "The store has replied."
              : "Waiting for the store to reply."}
        </p>
      </div>
      {justSent ? (
        <Alert tone="success" testId="conversation-sent">
          Thank you. Your message was sent, and we emailed you a copy with a link back here.
        </Alert>
      ) : null}
      <ol className="flex flex-col gap-3" data-testid="conversation-messages">
        {conversation.messages.map((message) => (
          <li
            key={message.id}
            className={`rounded-card border p-4 text-sm ${
              message.authorType === "staff" ? "border-line bg-surface-muted" : "border-line"
            }`}
            data-testid="conversation-message"
          >
            <p className="mb-1 font-medium">
              {message.authorType === "staff" ? `${message.authorName} (store)` : "You"}
              <span className="font-normal text-ink-muted">
                {" "}
                · {when.format(message.createdAt)}
              </span>
            </p>
            <p className="whitespace-pre-line">{message.body}</p>
          </li>
        ))}
      </ol>
      <AccountForm
        action={replyToConversationAction}
        submitLabel="Send"
        testId="conversation-reply"
      >
        <input type="hidden" name="id" value={conversation.id} />
        {accessKey ? <input type="hidden" name="key" value={accessKey} /> : null}
        <AccountTextArea label="Your reply" name="message" rows={4} maxLength={5000} />
      </AccountForm>
    </div>
  );
}
