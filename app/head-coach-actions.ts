"use server";

import { VIEW_ONLY, currentUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { editTeamStaff, type StaffEditInput } from "@/lib/head-coach";

// An Owner or Admin edits someone on a team's staff: name, cell and email (Thunder and every organization). Who may is
// checked again inside lib/head-coach.
export async function saveStaffInfo(org: string, teamId: string, input: StaffEditInput) {
  const user = await currentUser();
  if (!user) return { ok: false as const, message: "Please log in again." };
  if (user.actingBy) return { ok: false as const, message: VIEW_ONLY };
  return editTeamStaff({ pool: db, now: () => new Date() }, user, String(org), String(teamId), {
    coachId: input?.coachId,
    role: input?.role,
    first: input?.first,
    last: input?.last,
    cell: input?.cell,
    email: input?.email,
    newRole: input?.newRole,
  });
}
