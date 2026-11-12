import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          environment: "node",
          include: ["{apps,packages}/*/src/**/*.test.ts"],
          exclude: ["**/*.int.test.ts", "**/node_modules/**"],
        },
      },
      {
        // Needs the docker-compose services running and a .env file.
        test: {
          name: "integration",
          environment: "node",
          include: ["{apps,packages}/*/src/**/*.int.test.ts"],
          exclude: ["**/node_modules/**"],
          // Creates and migrates the separate test database, then points the
          // database URLs at it, so tests never touch the development data.
          globalSetup: ["./packages/testing/src/integration-global-setup.ts"],
          setupFiles: ["./packages/testing/src/load-env.ts"],
          testTimeout: 20_000,
          // Integration tests share one database, so files run one at a time.
          fileParallelism: false,
        },
      },
    ],
  },
});
