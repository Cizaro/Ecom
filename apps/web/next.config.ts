import { resolve } from "node:path";
import type { NextConfig } from "next";

// The single .env file lives at the repository root, not in apps/web.
try {
  process.loadEnvFile(resolve(import.meta.dirname, "../../.env"));
} catch {
  // No .env file: variables come from the real environment (CI, production).
}

// Baseline headers. A Content Security Policy is added with the design system
// in Milestone 1.5, once the set of script and style sources is known.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Workspace packages are consumed as TypeScript source.
  transpilePackages: ["@ecom/config", "@ecom/core", "@ecom/db", "@ecom/ui"],
  serverExternalPackages: ["pino", "ioredis", "pg", "@prisma/adapter-pg", "nodemailer"],
  outputFileTracingRoot: resolve(import.meta.dirname, "../.."),
  // Enables forbidden() and the 403 page used by the permission guard.
  experimental: { authInterrupts: true },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
