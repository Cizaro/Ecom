"use client";

import { buttonClasses, inputClasses } from "@ecom/ui";
import { useT } from "@/components/i18n";

/**
 * The sort drop-down. Choosing an option submits the surrounding form at
 * once; without JavaScript the form's own button does the same job.
 */
export function SortSelect({
  value,
  options,
}: {
  value: string;
  options: readonly { value: string; label: string }[];
}) {
  const t = useT();
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort" className="text-sm font-medium whitespace-nowrap">
        {t("Sort by")}
      </label>
      <select
        id="sort"
        name="sort"
        defaultValue={value}
        className={`${inputClasses} w-auto`}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <noscript>
        <button type="submit" className={buttonClasses("secondary")}>
          {t("Sort")}
        </button>
      </noscript>
    </div>
  );
}
