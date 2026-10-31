import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets phones on the home Wi-Fi use the dev server (e.g. http://192.168.1.16:3000).
  allowedDevOrigins: ["192.168.*.*"],
  cacheComponents: true,
  // A check build (NEXT_DIST_DIR=.next-check) writes elsewhere, so it never disturbs a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // No site, including this one, may show the app in a frame.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
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
