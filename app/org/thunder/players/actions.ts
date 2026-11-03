"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { featureRefusal } from "@/lib/features-server";
import { hasArea } from "@/lib/org-admin";
import { db } from "@/lib/db";
import { playerEvaluations } from "@/lib/evaluations";
import { playerTeam } from "@/lib/player-team";
import * as rosters from "@/lib/rosters";
import { addPlayer, removeAddedPlayer, type AddedPlayerInput } from "@/lib/added-players";

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

// teamId null: take the player off the team they came from (`from`; null: "Not on a team").
export async function movePlayer(registrantId: string, teamId: string | null, from: string | null) {
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
      from === null ? null : String(from),
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

// Owners, Admins and Directors of Players: add a player in the app (fees can be waived), or remove one added here.
// Checked again in lib/added-players.
export async function addPlayerAction(input: AddedPlayerInput) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await addPlayer({ pool: db, now: () => new Date() }, user, input);
  } catch (e) {
    console.error("Add player failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}

export async function removeAddedPlayerAction(registrantId: string) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  try {
    return await removeAddedPlayer({ pool: db, now: () => new Date() }, user, String(registrantId));
  } catch (e) {
    console.error("Remove added player failed:", e);
    return { ok: false as const, message: "Something went wrong. Please try again." };
  }
}
