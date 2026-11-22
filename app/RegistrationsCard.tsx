import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { playerRegistrations, teamRegistrations } from "@/lib/registrations-list";
import PlayerRegistrationsView from "./PlayerRegistrationsView";
import RegistrationsView from "./RegistrationsView";

// Home's Registrations card: a CourtTeams organization's registered teams (Scenic City), or a CourtPlayers
// organization's registered players. Its Owners only for now. Who may see it is checked in
// lib/registrations-list; anyone else sees a note.
export default async function RegistrationsCard({
  user,
  org,
  kind,
  programId,
}: {
  user: SessionUser;
  org: string;
  kind: "teams" | "players";
  programId?: string; // one program's registrations (inside its card under Programs)
}) {
  const deps = { pool: db, now: () => new Date() };
  if (kind === "players") {
    const data = await playerRegistrations(deps, user, org);
    if (!data) return <p className="text-sm text-zinc-500">Only the organization&apos;s Owners see registrations.</p>;
    return <PlayerRegistrationsView programs={data.programs} rows={data.rows} />;
  }
  const data = await teamRegistrations(deps, user, programId);
  if (!data) return <p className="text-sm text-zinc-500">Only the organization&apos;s Owners see registrations.</p>;
  return <RegistrationsView programs={data.programs} rows={data.rows} />;
}
