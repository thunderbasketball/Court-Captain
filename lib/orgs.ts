// CourtCaptain organizations (SPEC.md sections 13-14). Organizations are data (the organizations table; lib/org-registry.ts
// reads them on the server). This file holds what both server and browser code share.
export type OrgSlug = string; // e.g. "thunder", "scenic-city", or a registered organization's slug

// A slug as it may appear in a link (still checked against the organizations table where it matters).
export const isOrgSlug = (s: unknown): s is OrgSlug => typeof s === "string" && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(s);

// The two organizations with their own sections of the site (Thunder's tabs, Scenic City under /scenic).
export const BUILT_IN = ["thunder", "scenic-city"] as const;

// CourtCaptain itself, for its Admins' page (SPEC.md section 14).
export const PLATFORM_BRAND = {
  name: "CourtCaptain",
  logo: { src: "/brand/courtcaptain-192.png", width: 192, height: 128 },
  login: "/login",
};

// Scenic City roles that give access (a Request alone doesn't), highest first.
export const SCENIC_ROLES = ["Director", "Partner", "Solo", "Coach"] as const; // Partner: retired (no one holds it; not offered)
export type ScenicRole = (typeof SCENIC_ROLES)[number];
