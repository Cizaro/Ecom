/**
 * Every field name and every number anywhere inside a value. For asserting
 * that something (a cost price, say) does not appear in what a function
 * returns, without searching text: random identifiers can contain any run of
 * digits, so a text search for "999" fails by chance now and then.
 */
export function fieldsAndNumbers(value: unknown): { fields: Set<string>; numbers: Set<number> } {
  const fields = new Set<string>();
  const numbers = new Set<number>();
  const visit = (item: unknown) => {
    if (typeof item === "number") numbers.add(item);
    else if (Array.isArray(item)) item.forEach(visit);
    else if (item !== null && typeof item === "object") {
      for (const [key, child] of Object.entries(item)) {
        fields.add(key);
        visit(child);
      }
    }
  };
  visit(value);
  return { fields, numbers };
}
