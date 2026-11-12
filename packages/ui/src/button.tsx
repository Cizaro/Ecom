import type { ComponentProps } from "react";
import { cx } from "./cx";

export type ButtonTone = "primary" | "secondary" | "danger";

const TONES: Record<ButtonTone, string> = {
  primary: "bg-brand text-brand-contrast hover:bg-brand-hover",
  secondary: "border border-line-strong bg-surface text-ink hover:bg-surface-muted",
  danger: "bg-danger text-white hover:opacity-90",
};

/**
 * Classes for anything that should look like a button, including links
 * (`<Link className={buttonClasses()}>`). 44px minimum height for touch.
 */
export function buttonClasses(tone: ButtonTone = "primary", extra?: string): string {
  return cx(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-control px-4 text-sm font-medium",
    "transition-colors disabled:cursor-not-allowed disabled:opacity-60",
    TONES[tone],
    extra,
  );
}

export function Button({
  tone = "primary",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { tone?: ButtonTone }) {
  return <button type={type} className={buttonClasses(tone, className)} {...props} />;
}
