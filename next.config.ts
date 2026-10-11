import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Verification builds can use their own folder (NEXT_DIST_DIR=.next-verify) so they never touch a running `pnpm dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
