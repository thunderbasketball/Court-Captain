import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets phones on the home Wi-Fi use the dev server (e.g. http://192.168.1.16:3000).
  allowedDevOrigins: ["192.168.*.*"],
  cacheComponents: true,
  // Uploads through server actions (a League's rules PDF, up to 4 MB) need more than the 1 MB default.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
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
  // Thunder's and Scenic City's pages moved under /org/<slug> like every organization's; old links and bookmarks still work.
  async redirects() {
    return [
      { source: "/thunder", destination: "/org/thunder", permanent: false },
      ...["teams", "uniforms", "facilities", "practice", "members", "players"].map((p) => ({
        source: `/${p}/:path*`,
        destination: `/org/thunder/${p}/:path*`,
        permanent: false,
      })),
      { source: "/scenic/:path*", destination: "/org/scenic-city/:path*", permanent: false },
    ];
  },
  partialPrefetching: true,
  turbopack: { rules: { "*.css": { loaders: ["@tailwindcss/turbopack"], as: "*.css" } } },
};

export default nextConfig;
