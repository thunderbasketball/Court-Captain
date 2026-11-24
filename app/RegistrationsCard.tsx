import type { SessionUser } from "@/lib/auth/service";
import { db } from "@/lib/db";
import { playerRegistrations, teamRegistrations } from "@/lib/registrations-list";
import { stripeApi } from "@/lib/stripe/client";
import { fillStripeRefs, paymentsByTeam } from "@/lib/stripe/refunds";
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
  // Card payments (and Refund) on each registered team's card; Owners only (checked in lib/stripe/refunds).
  const stripe = stripeApi();
  await fillStripeRefs({ pool: db, stripe }, user, data.programs.map((p) => p.id)); // each payment's reference in Stripe (asked once)
  const payments = await paymentsByTeam(
    db,
    user,
    data.programs.map((p) => p.id),
    stripe?.live ?? false,
  );
  return <RegistrationsView programs={data.programs} rows={data.rows} payments={payments ?? {}} canRefund={!!stripe && !!payments} />;
}
