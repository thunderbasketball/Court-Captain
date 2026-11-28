"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { LOGO_MAX, setTeamLogo } from "@/lib/team-logos";

// A team's logo: the chosen image, or remove it (no file). Who may is checked again in lib/team-logos (its Head Coach or
// Team Manager, or its organization's Directors of Teams), never from the browser.
export async function saveTeamLogo(kind: string, id: string, form: FormData) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    const f = form.get("logo");
    const logo =
      f instanceof File && f.size
        ? { bytes: f.size > LOGO_MAX + 1024 ? new Uint8Array(f.size) : new Uint8Array(await f.arrayBuffer()), type: f.type }
        : null;
    if (!logo && form.get("remove") !== "1") return { ok: false as const, message: "Choose an image." };
    return await setTeamLogo({ pool: db, now: () => new Date() }, user, kind, id, logo);
  } catch (e) {
    console.error("Team logo failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
