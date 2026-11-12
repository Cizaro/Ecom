import js from "@eslint/js";
import nextPlugin from "@next/eslint-plugin-next";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "**/coverage/**",
      "**/generated/**",
      "**/next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Environment variables are read and validated only in packages/config.
      "no-restricted-properties": [
        "error",
        {
          object: "process",
          property: "env",
          message: "Read configuration through getEnv() from @ecom/config.",
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: { "@next/next": nextPlugin },
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
    },
    settings: { next: { rootDir: "apps/web" } },
  },
  {
    // The only places allowed to touch process.env directly.
    files: [
      "packages/config/**",
      "packages/db/prisma.config.ts",
      "packages/db/scripts/**",
      "packages/testing/src/load-env.ts",
      "apps/web/next.config.ts",
      "playwright.config.ts",
      "e2e/**",
      "scripts/**",
    ],
    rules: { "no-restricted-properties": "off" },
  },
  {
    // The admin database connection bypasses Row-Level Security. Only the
    // identity and platform modules, migrations and command-line scripts may
    // use it; everything else receives a TenantDb (see ARCHITECTURE.md).
    files: ["**/*.{ts,tsx,mjs}"],
    ignores: [
      "packages/db/**",
      "packages/core/src/identity/**",
      "packages/core/src/platform/**",
      "apps/web/src/server/auth.ts",
      "apps/web/src/server/access.ts",
      "scripts/**",
      "e2e/**",
      "**/*.int.test.ts",
    ],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@ecom/db",
              importNames: ["getAdminPrisma", "AdminPrismaClient"],
              message:
                "The admin connection bypasses Row-Level Security. Use a TenantDb from the request context.",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
