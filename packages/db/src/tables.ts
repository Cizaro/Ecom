/**
 * Tables that are deliberately NOT protected by Row-Level Security because
 * they hold no tenant data. Every other table in the public schema must have
 * RLS enabled; an integration test enforces this, so adding a table means
 * either writing its policy or listing it here with a reason.
 */
export const GLOBAL_TABLES: Record<string, string> = {
  _prisma_migrations: "Migration bookkeeping; not accessible to the runtime role.",
  permissions: "Global catalogue of permission keys; read-only for the runtime role.",
};
