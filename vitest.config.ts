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
          setupFiles: ["./packages/testing/src/load-env.ts"],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
