import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { orgFeatures } from "@/lib/features";
import { hasArea, isThunderAdmin } from "@/lib/org-admin";

export type MembersPart = "staff" | "requests" | "coaches" | "players" | "families";

// Members: Staff (Admins), Coaches (Directors of Coaches; with Team Management), Players and Families (Directors of
// Players or Teams; with Player Registration). Admins see them all. Requests first while someone is waiting.
export async function memberParts(user: SessionUser): Promise<{ key: MembersPart; title: string; alert?: boolean }[]> {
  const f = await orgFeatures(db, "thunder");
  const waiting = await waitingRequests(user);
  const parts: { key: MembersPart; title: string; alert?: boolean; show: boolean }[] = [
    { key: "requests", title: `Requests (${waiting})`, alert: true, show: waiting > 0 },
    { key: "staff", title: "Staff", show: isThunderAdmin(user) },
    { key: "coaches", title: "Coaches", show: hasArea(user, "teams") && f.has("team-building") },
    { key: "players", title: "Players", show: hasArea(user, "players", "teams") && f.has("player-registration") },
    { key: "families", title: "Families", show: hasArea(user, "players", "teams") && f.has("player-registration") },
  ];
  return parts.filter((p) => p.show);
}

// People waiting to join Thunder (Admins approve them).
export async function waitingRequests(user: SessionUser): Promise<number> {
  if (!isThunderAdmin(user)) return 0;
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from users u where u.active and has_role(u.coach_id, 'thunder', 'Request')
       and not has_role(u.coach_id, 'thunder', 'Coach') and not has_role(u.coach_id, 'thunder', 'Director')
       and not exists (select 1 from team_staff s where s.coach_id = u.coach_id)`,
  );
  return r.rows[0].n;
}
