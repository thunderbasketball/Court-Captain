"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { featureRefusal } from "@/lib/features-server";
import { hasArea } from "@/lib/org-admin";
import { db } from "@/lib/db";
import { playerEvaluations } from "@/lib/evaluations";
import { playerTeam } from "@/lib/player-team";
import * as rosters from "@/lib/rosters";

// Director only (checked again inside lib/player-team). Viewing, so allowed while viewing as someone.
export async function loadPlayerTeam(registrantId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  const refused = await featureRefusal("thunder", "player-registration");
  if (refused) return refused;
  if (!hasArea(user, "players", "teams"))
    return { ok: false as const, message: "Only a Director of Players or Teams can see this." };
  try {
    return { ok: true as const, team: await playerTeam({ pool: db, now: () => new Date() }, user, String(registrantId)) };
  } catch (e) {
    console.error("Player team failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Roster board for one gender and grade (Director only, checked again inside lib/rosters).
export async function loadRosterBoard(gender: string, grade: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  const refused = await featureRefusal("thunder", "player-registration");
  if (refused) return refused;
  try {
    const board = await rosters.rosterBoard({ pool: db, now: () => new Date() }, user, String(gender), String(grade));
    return board ? { ok: true as const, board } : { ok: false as const, message: "Only a Director of Teams can roster players." };
  } catch (e) {
    console.error("Roster board failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// teamId null: take the player off their team.
export async function movePlayer(registrantId: string, teamId: string | null) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  const refused = await featureRefusal("thunder", "player-registration");
  if (refused) return refused;
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await rosters.movePlayer(
      { pool: db, now: () => new Date() },
      user,
      String(registrantId),
      teamId === null ? null : String(teamId),
    );
  } catch (e) {
    console.error("Move player failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

// Director: one player's evaluation card for each team they can play for (checked again inside lib/evaluations).
export async function loadPlayerEvaluations(registrantId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  // Evaluations are part of Player Registration when Team Management is on too.
  const refused = (await featureRefusal("thunder", "player-registration")) ?? (await featureRefusal("thunder", "team-building"));
  if (refused) return refused;
  try {
    const teams = await playerEvaluations({ pool: db, now: () => new Date() }, user, String(registrantId));
    return teams ? { ok: true as const, teams } : { ok: false as const, message: "Only a Director of Teams can evaluate here." };
  } catch (e) {
    console.error("Player evaluations failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
