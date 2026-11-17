"use client";

import { Alert, Badge, buttonClasses, Select, TextArea } from "@ecom/ui";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { tryAnswerAction, type TryAnswerState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClasses()}>
      {pending ? "Asking…" : "Draft an answer"}
    </button>
  );
}

const ROUTE_LABEL: Record<string, string> = {
  draft: "Draft for staff",
  needs_approval: "Needs a person's approval",
  auto: "Could be sent automatically",
};

/** Ask a question as a customer would; see the drafted answer and the facts it used. */
export function TryAnswerForm({ languages }: { languages: string[] }) {
  const [state, action] = useActionState<TryAnswerState, FormData>(tryAnswerAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" data-testid="ai-try-form">
      <TextArea
        id="ai-question"
        label="A customer's question"
        name="question"
        rows={3}
        maxLength={4000}
        defaultValue={state.question}
        hint="Try it as a customer would write it. Nothing is sent to anyone."
      />
      {languages.length > 1 ? (
        <Select
          label="Answer in"
          name="language"
          defaultValue={state.language ?? "en"}
          options={[
            { value: "en", label: "English" },
            { value: "ar", label: "العربية" },
          ]}
        />
      ) : (
        <input type="hidden" name="language" value="en" />
      )}
      <div>
        <Submit />
      </div>
      {state.error ? (
        <Alert tone="error" testId="ai-try-error">
          {state.error}
        </Alert>
      ) : null}
      {state.result ? (
        <div
          className="flex flex-col gap-3 rounded-card border border-line p-4"
          data-testid="ai-try-result"
        >
          <div className="flex flex-wrap gap-2 text-sm">
            <Badge tone={state.result.answered ? "success" : "warning"}>
              {state.result.answered ? "Answered from the facts" : "No answer in the facts"}
            </Badge>
            <Badge tone="neutral">{ROUTE_LABEL[state.result.route] ?? state.result.route}</Badge>
            {state.result.handover ? <Badge tone="warning">Hand over to a person</Badge> : null}
          </div>
          <p
            className="whitespace-pre-line"
            dir={state.language === "ar" ? "rtl" : "ltr"}
            data-testid="ai-try-reply"
          >
            {state.result.reply}
          </p>
          {state.result.citations.length > 0 ? (
            <div className="text-sm">
              <p className="font-medium">Facts it used</p>
              <ul className="mt-1 list-disc ps-5 text-ink-muted" data-testid="ai-try-citations">
                {state.result.citations.map((citation) => (
                  <li key={citation.id}>
                    <code>{citation.id}</code>: {citation.text}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
