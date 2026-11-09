"use server";

import { cookies } from "next/headers";
import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { CONTEXT_COOKIE } from "@/lib/contexts";
import { db } from "@/lib/db";
import { switchSoloToOrg } from "@/lib/court-solo";
import { createOrganization, renameOrg, setOrgAbbr, setOrgColor, setOrgLogo, type Logo } from "@/lib/org-signup";

const deps = { pool: db, now: () => new Date() };

async function logoFrom(form: FormData): Promise<Logo> {
  const f = form.get("logo");
  if (!(f instanceof File) || !f.size) return null;
  if (f.size > 600 * 1024) return { bytes: new Uint8Array(f.size), type: f.type }; // refused as too big by the rules
  return { bytes: new Uint8Array(await f.arrayBuffer()), type: f.type };
}

// Register a new organization (logged in; checked again in lib/org-signup). Opens it in the new organization.
export async function registerOrganization(form: FormData) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    const r = await createOrganization(
      deps,
      user,
      {
        name: form.get("name"),
        short: form.get("short"),
        kind: form.get("kind"),
        color: form.get("color"),
        features: form.getAll("features"),
      },
      await logoFrom(form),
    );
    if (r.ok)
      (await cookies()).set(CONTEXT_COOKIE, `org:${r.slug}`, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    return r;
  } catch (e) {
    console.error("Register organization failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function changeOrgAbbr(org: string, abbr: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setOrgAbbr(deps, user, String(org), abbr);
  } catch (e) {
    console.error("Abbreviation change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function changeOrgColor(org: string, color: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setOrgColor(deps, user, String(org), color);
  } catch (e) {
    console.error("Color change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function changeOrgLogo(org: string, form: FormData) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await setOrgLogo(deps, user, String(org), await logoFrom(form));
  } catch (e) {
    console.error("Logo change failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Owners: change the name and short name; the web address follows the name (the page moves there).
export async function renameOrganization(org: string, name: string, short: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    const r = await renameOrg(deps, user, String(org), { name, short });
    if (r.ok && r.slug !== org) {
      // The remembered role chip follows the organization to its new address.
      const jar = await cookies();
      if (jar.get(CONTEXT_COOKIE)?.value === `org:${org}`)
        jar.set(CONTEXT_COOKIE, `org:${r.slug}`, {
          httpOnly: true,
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          path: "/",
          maxAge: 60 * 60 * 24 * 365,
        });
    }
    return r;
  } catch (e) {
    console.error("Organization rename failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Switch the person's CourtSolo account to CourtOrg, bringing its team (lib/court-solo). Opens it on its Teams page.
export async function switchSoloAccount(slug: string, name: string, short: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  const r = await switchSoloToOrg(deps, user, slug, { name, short: short || name.slice(0, 20) });
  if (r.ok)
    (await cookies()).set(CONTEXT_COOKIE, `org:${r.slug}`, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  return r;
}
