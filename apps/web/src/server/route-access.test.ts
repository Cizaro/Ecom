import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADMIN_ACTIONS,
  ADMIN_API,
  ADMIN_PAGES,
  guardCallFor,
  STOREFRONT_ACTIONS,
  STOREFRONT_GUARD,
  type RouteAccess,
} from "./route-access";

// Fails when an admin page, server action or API route has no entry in the
// access registry, or when its source does not call the guard its entry
// requires. Together with the end-to-end isolation suite this makes "forgot
// the permission check" a CI failure rather than a security bug.

const APP_DIR = join(import.meta.dirname, "..", "app");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

const files = walk(APP_DIR);
const rel = (file: string) => relative(APP_DIR, file).split(sep).join("/");

/** `(admin)/admin/(protected)/team/page.tsx` -> `/admin/team` */
function routePath(file: string): string {
  const segments = rel(file)
    .split("/")
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment));
  return `/${segments.join("/")}`;
}

function expectGuard(source: string, access: RouteAccess, where: string) {
  const guard = guardCallFor(access);
  if (guard) expect(source, `${where} must call ${guard}`).toContain(guard);
}

describe("admin pages", () => {
  const pages = files.filter((file) => rel(file).startsWith("(admin)/") && /page\.tsx$/.test(file));

  it("finds the pages", () => {
    expect(pages.length).toBeGreaterThan(5);
  });

  for (const file of pages) {
    const path = routePath(file);
    it(`${path} is registered and guarded`, () => {
      const entry = ADMIN_PAGES.find((page) => page.path === path);
      expect(entry, `${path} has no entry in ADMIN_PAGES (server/route-access.ts)`).toBeDefined();
      expectGuard(readFileSync(file, "utf8"), entry!.access, path);
    });
  }

  it("has no registry entries for pages that no longer exist", () => {
    const existing = new Set(pages.map(routePath));
    expect(ADMIN_PAGES.map((page) => page.path).filter((path) => !existing.has(path))).toEqual([]);
  });
});

describe("server actions", () => {
  const actionFiles = files.filter(
    (file) => /\.tsx?$/.test(file) && /^\s*["']use server["']/.test(readFileSync(file, "utf8")),
  );

  const exported = actionFiles.flatMap((file) => {
    const source = readFileSync(file, "utf8");
    const matches = [...source.matchAll(/^export async function (\w+)/gm)];
    return matches.map((match, index) => {
      const start = match.index;
      const end = matches[index + 1]?.index ?? source.length;
      return { id: `${rel(file)}#${match[1]}`, body: source.slice(start, end) };
    });
  });

  it("finds the actions", () => {
    expect(exported.length).toBeGreaterThan(5);
  });

  const isStorefront = (id: string) => id.startsWith("(storefront)/");

  for (const action of exported.filter((candidate) => !isStorefront(candidate.id))) {
    it(`${action.id} is registered and guarded`, () => {
      const entry = ADMIN_ACTIONS.find((candidate) => candidate.id === action.id);
      expect(entry, `${action.id} has no entry in ADMIN_ACTIONS`).toBeDefined();
      expectGuard(action.body, entry!.access, action.id);
    });
  }

  // Visitors' actions need no sign-in, so the check is different: each must
  // be listed, be public, and take its store from the host name.
  for (const action of exported.filter((candidate) => isStorefront(candidate.id))) {
    it(`${action.id} is a registered storefront action bound to the store's host`, () => {
      const entry = STOREFRONT_ACTIONS.find((candidate) => candidate.id === action.id);
      expect(entry, `${action.id} has no entry in STOREFRONT_ACTIONS`).toBeDefined();
      expect(entry!.access).toEqual({ level: "public" });
      expect(action.body, `${action.id} must call ${STOREFRONT_GUARD}`).toContain(STOREFRONT_GUARD);
      // A visitor's action must never reach for staff access.
      expect(action.body).not.toMatch(/requirePermission|requireSession|requireTenantContext/);
    });
  }

  it("has no registry entries for actions that no longer exist", () => {
    const existing = new Set(exported.map((action) => action.id));
    const registered = [...ADMIN_ACTIONS, ...STOREFRONT_ACTIONS].map((a) => a.id);
    expect(registered.filter((id) => !existing.has(id))).toEqual([]);
  });

  it("keeps staff actions under the admin and visitor actions under the storefront", () => {
    for (const file of actionFiles) {
      expect(rel(file)).toMatch(/^(\(admin\)\/admin|\(storefront\))\//);
    }
    for (const entry of ADMIN_ACTIONS) expect(entry.id).toMatch(/^\(admin\)\/admin\//);
    for (const entry of STOREFRONT_ACTIONS) expect(entry.id).toMatch(/^\(storefront\)\//);
  });
});

describe("API routes", () => {
  const routes = files.filter((file) => rel(file).startsWith("api/v1/") && /route\.ts$/.test(file));

  for (const file of routes) {
    const path = routePath(file);
    const source = readFileSync(file, "utf8");
    const methods = [...source.matchAll(/^export const (GET|POST|PATCH|PUT|DELETE) =/gm)].map(
      (match) => match[1],
    );

    it(`${path} exports only apiRoute handlers`, () => {
      expect(methods.length).toBeGreaterThan(0);
      expect(source).not.toMatch(/^export (async )?function/m);
    });

    for (const method of methods) {
      it(`${method} ${path} is registered with the access it declares`, () => {
        const entry = ADMIN_API.find((api) => api.path === path && api.method === method);
        expect(entry, `${method} ${path} has no entry in ADMIN_API`).toBeDefined();
        const declared =
          entry!.access.level === "permission"
            ? `access: { level: "permission", permission: "${entry!.access.permission}" }`
            : `access: { level: "${entry!.access.level}" }`;
        expect(source).toContain(`export const ${method} = apiRoute({ ${declared}`);
      });
    }
  }

  it("has no registry entries for API routes that no longer exist", () => {
    const existing = new Set(routes.map(routePath));
    expect(ADMIN_API.map((api) => api.path).filter((path) => !existing.has(path))).toEqual([]);
  });
});
