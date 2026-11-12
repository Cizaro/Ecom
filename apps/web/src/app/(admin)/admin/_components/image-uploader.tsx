"use client";

import { Alert, buttonClasses, inputClasses } from "@ecom/ui";
import { useId, useRef, useState, type FormEvent } from "react";
import type { FormState } from "../actions";

const ACCEPT = "image/jpeg,image/png,image/webp";

interface Outcome {
  uploaded: number;
  problems: string[];
}

/**
 * Chooses one or more images and sends them to a server action one at a
 * time, so each request stays small and one bad file does not stop the rest.
 * The size check here only saves a wasted upload; the server checks again
 * and decides from the file's content whether it is an image.
 */
export function ImageUploader({
  action,
  fields,
  label,
  hint,
  submitLabel,
  multiple = false,
  maxBytes,
}: {
  action: (previous: FormState, formData: FormData) => Promise<FormState>;
  /** Hidden values sent with every file (for example the product ID). */
  fields: Record<string, string>;
  label: string;
  hint?: string;
  submitLabel: string;
  multiple?: boolean;
  maxBytes: number;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const megabytes = Math.round(maxBytes / (1024 * 1024));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const files = [...(input.current?.files ?? [])];
    if (files.length === 0) {
      setOutcome({ uploaded: 0, problems: ["Choose an image file to upload."] });
      return;
    }
    const result: Outcome = { uploaded: 0, problems: [] };
    setOutcome(null);
    for (const [index, file] of files.entries()) {
      setProgress(files.length > 1 ? `Uploading ${index + 1} of ${files.length}…` : "Uploading…");
      if (file.size > maxBytes) {
        result.problems.push(`${file.name}: too large. The limit is ${megabytes} MB.`);
        continue;
      }
      const formData = new FormData();
      for (const [name, value] of Object.entries(fields)) formData.set(name, value);
      formData.set("image", file);
      try {
        const state = await action({}, formData);
        if (state.error) result.problems.push(`${file.name}: ${state.error}`);
        else result.uploaded += 1;
      } catch {
        result.problems.push(`${file.name}: could not be uploaded. Please try again.`);
      }
    }
    if (input.current) input.current.value = "";
    setProgress(null);
    setOutcome(result);
  }

  const busy = progress !== null;
  return (
    <form onSubmit={submit} className="flex flex-col gap-3" data-testid="image-uploader">
      {outcome?.problems.map((problem) => (
        <Alert key={problem} tone="error" testId="upload-error">
          {problem}
        </Alert>
      ))}
      {outcome && outcome.uploaded > 0 ? (
        <Alert tone="success" testId="upload-notice">
          {outcome.uploaded === 1 ? "1 image uploaded." : `${outcome.uploaded} images uploaded.`}
        </Alert>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <input
          ref={input}
          id={id}
          type="file"
          accept={ACCEPT}
          multiple={multiple}
          disabled={busy}
          aria-describedby={`${id}-hint`}
          className={`${inputClasses} py-2`}
        />
        <p id={`${id}-hint`} className="text-sm text-ink-muted">
          {hint ? `${hint} ` : ""}JPEG, PNG or WebP, up to {megabytes} MB each.
        </p>
      </div>
      <div>
        <button
          type="submit"
          disabled={busy}
          aria-busy={busy}
          className={buttonClasses("secondary")}
        >
          {progress ?? submitLabel}
        </button>
      </div>
      <p className="sr-only" role="status">
        {progress ?? ""}
      </p>
    </form>
  );
}
