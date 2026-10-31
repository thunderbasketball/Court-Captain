// CourtCaptain organizations and how each one looks: header logo, its own login page (SPEC.md sections 13-14).
export type OrgSlug = "thunder" | "scenic-city";

type Img = { src: string; width: number; height: number };
export const ORGS: Record<OrgSlug, { name: string; short: string; logo: Img; bigLogo: Img; login: string }> = {
  thunder: {
    name: "Thunder Basketball",
    short: "Thunder",
    logo: { src: "/brand/logo-96.png", width: 96, height: 96 },
    bigLogo: { src: "/brand/logo-256.png", width: 256, height: 256 },
    login: "/login/thunder",
  },
  "scenic-city": {
    name: "Scenic City Basketball",
    short: "Scenic City",
    logo: { src: "/brand/scenic-city-192.png", width: 192, height: 192 },
    bigLogo: { src: "/brand/scenic-city-512.png", width: 512, height: 512 },
    login: "/login/scenic-city",
  },
};

// CourtCaptain itself, for its Admins' page (SPEC.md section 14).
export const PLATFORM_BRAND = {
  name: "CourtCaptain",
  logo: { src: "/brand/courtcaptain-192.png", width: 192, height: 128 },
  login: "/login",
};

export const ORG_SLUGS = Object.keys(ORGS) as OrgSlug[];
export const isOrgSlug = (s: unknown): s is OrgSlug => typeof s === "string" && s in ORGS;

// Scenic City roles that give access (a Request alone doesn't), highest first.
export const SCENIC_ROLES = ["Director", "Partner", "Solo", "Coach"] as const;
export type ScenicRole = (typeof SCENIC_ROLES)[number];
