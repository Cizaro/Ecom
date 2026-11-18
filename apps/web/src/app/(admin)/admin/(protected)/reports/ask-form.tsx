"use client";

import { Alert, buttonClasses, TextArea } from "@ecom/ui";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { askReportsAction, type AskState } from "./actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClasses()}>
      {pending ? "Looking…" : "Ask"}
    </button>
  );
}

/** Ask about the figures on this page; the answer quotes them and shows which it used. */
export function AskForm({ days }: { days: number }) {
  const [state, action] = useActionState<AskState, FormData>(askReportsAction, {});
  return (
    <form action={action} className="flex flex-col gap-4" data-testid="reports-ask-form">
      <input type="hidden" name="days" value={days} />
      <TextArea
        id="reports-question"
        label="Your question"
        name="question"
        rows={2}
        maxLength={500}
        defaultValue={state.question}
        hint="For example: which product sold best? What did people search for and not find?"
      />
      <div>
        <Submit />
      </div>
      {state.error ? (
        <Alert tone="error" testId="reports-ask-error">
          {state.error}
        </Alert>
      ) : null}
      {state.result ? (
        <div
          className="flex flex-col gap-3 rounded-card border border-line p-4"
          data-testid="reports-answer"
        >
          <p className="whitespace-pre-line">{state.result.answer}</p>
          {state.result.citations.length > 0 ? (
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">Figures it used</p>
              <ul
                className="list-disc pl-5 text-sm text-ink-muted"
                data-testid="reports-answer-figures"
              >
                {state.result.citations.map((c) => (
                  <li key={c.id}>{c.text}</li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-ink-muted">The figures on this page do not answer that.</p>
          )}
        </div>
      ) : null}
    </form>
  );
}
