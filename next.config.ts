import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Lets the e2e suite run a second dev server (live mode) with its own build dir.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["postgres"],
  // forbidden() for staff-only server actions (e.g. demo sign-in outside demo mode).
  experimental: { authInterrupts: true },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");
export default withNextIntl(nextConfig);
