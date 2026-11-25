"use server";

import { currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { hasFeature } from "@/lib/features";
import { parentView } from "@/lib/parent-view";
import { articlesFor, listArticles } from "@/lib/support";
import { orgNeeds } from "@/lib/support-audience";
import { easternDate } from "@/lib/time";
import { releasesFor } from "@/lib/whats-new-seen";

// What a player's parent sees (who may look is checked in lib/parent-view), with a parent's Support and What's New.
export async function loadParentView(registrantId: string, slot: 1 | 2) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (!(await hasFeature(db, "thunder", "player-registration"))) return { ok: false as const, message: "Not found." };
  const now = new Date();
  const view = await parentView({ pool: db, now: () => now }, user, registrantId, slot);
  if (!view) return { ok: false as const, message: "Only the team's coaches and the organization's directors can see this." };
  const as = [{ who: new Set(["parent", "everyone"]), has: await orgNeeds("thunder"), areas: new Set<string>() }];
  return { ok: true as const, view, today: easternDate(now), articles: articlesFor(await listArticles(db), as), releases: releasesFor(as) };
}
