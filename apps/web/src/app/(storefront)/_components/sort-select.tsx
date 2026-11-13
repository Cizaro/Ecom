"use client";

import { buttonClasses, inputClasses } from "@ecom/ui";

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
  return (
    <div className="flex items-center gap-2">
      <label htmlFor="sort" className="text-sm font-medium whitespace-nowrap">
        Sort by
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
          Sort
        </button>
      </noscript>
    </div>
  );
}
