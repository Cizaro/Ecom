"use client";

import { Alert, buttonClasses, Select, TextArea } from "@ecom/ui";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { draftCaptionAction, type CaptionDraftState } from "../../actions";

function Submit() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClasses("secondary")}
    >
      {pending ? "Writing…" : "Draft a caption with AI"}
    </button>
  );
}

/** An AI caption from the featured products' facts; "Use it" copies it into the caption box. */
export function CaptionDraft({ postId, languages }: { postId: string; languages: string[] }) {
  const [state, action] = useActionState<CaptionDraftState, FormData>(draftCaptionAction, {});
  const use = () => {
    const box = document.getElementById("caption");
    if (box instanceof HTMLTextAreaElement && state.caption) {
      box.value = state.caption;
      box.focus();
    }
  };
  return (
    <form action={action} className="flex flex-col gap-3" data-testid="caption-draft">
      <input type="hidden" name="id" value={postId} />
      <TextArea
        id="caption-brief"
        label="What should it say?"
        name="brief"
        rows={2}
        maxLength={1000}
        hint="Optional, for example: introduce the new totes for summer. It uses only the products' real details."
      />
      {languages.length > 1 ? (
        <Select
          label="Language"
          name="language"
          defaultValue="en"
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
      {state.error ? <Alert tone="error">{state.error}</Alert> : null}
      {state.caption ? (
        <div className="flex flex-col gap-2 rounded-card border border-line p-3">
          <p className="whitespace-pre-line text-sm" data-testid="caption-draft-text">
            {state.caption}
          </p>
          <div>
            <button type="button" onClick={use} className={buttonClasses("secondary")}>
              Use it in the caption
            </button>
          </div>
          <p className="text-xs text-ink-muted">
            Check it before saving: it is a draft. Remember to save the post.
          </p>
        </div>
      ) : null}
    </form>
  );
}
