import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { listGyms } from "@/lib/practice/schedule";
import AppHeader from "../../../../AppHeader";
import type { ReactNode } from "react";
import { Chip, PageTitle } from "../../../../ui";
import SubCard from "../../../../SubCard";
import FacilitiesNav from "../FacilitiesNav";
import { GymGear, ThunderGymMenu } from "../../../../GymMenu";
import GymPlace from "../../../../GymPlace";
import { AddGymButton } from "../../practice/PracticeTools";
import ImportGymsButton from "../../../../ImportGyms";
import { hasArea } from "@/lib/org-admin";

import { PageFrame } from "../../../../ui";

// `calendars`: each gym's availability calendar by its id (Facilities → Gyms), shown inside that gym's card.
export async function GymsContent({
  embedded = false,
  calendars,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
  calendars?: Record<string, ReactNode>;
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (!hasArea(user, "facilities", "practices")) {
    if (embedded) return null;
    redirect("/");
  }
  const gyms = await listGyms({ pool: db });
  // How many teams list each gym as a practice location, and how many upcoming slots it has.
  const usage = await db.query<{ name: string; teams: number; upcoming: number; booked: number }>(
    `select g.name,
            (select count(*) from teams t where exists (select 1 from unnest(t.practice_locations) l where lower(l) = lower(g.name)))::int as teams,
            (select count(*) from slots s join courts c on c.id = s.court_id where c.gym_id = g.id and s.starts_at > now())::int as upcoming,
            (select count(*) from slots s join courts c on c.id = s.court_id
             where c.gym_id = g.id and s.starts_at > now() and s.team_id is not null)::int as booked
     from gyms g where g.org = 'thunder'`,
  );
  const use = new Map(usage.rows.map((u) => [u.name, u]));

  return (
    <>
      {!embedded && <AppHeader user={user} tab="facilities" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-6xl flex-1 space-y-3 px-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          {!embedded && <PageTitle title="Gyms" subtitle="Thunder's gyms and their courts" />}
          {/* Inside a card, Import and + Add are icons on the card's title line instead (GymToolIcons). */}
          {!embedded && (
            <div className="flex shrink-0 gap-2">
              <ImportGymsButton org="thunder" />
              <AddGymButton />
            </div>
          )}
        </div>
        {!embedded && <FacilitiesNav current="gyms" />}
        {/* Each gym a card that opens right here: its slots and teams, its courts, and (Facilities) its availability. */}
        <div className="space-y-2">
          {/* Removed gyms kept for their past practices are hidden; adding one with the same name brings it back. */}
          {gyms
            .filter((g) => g.active)
            .map((g) => (
              <SubCard
                key={g.id}
                title={g.name}
                count={`${g.courts.filter((c) => c.active).length} court${g.courts.filter((c) => c.active).length === 1 ? "" : "s"}`}
                action={<GymGear gymId={g.id} name={g.name} />}
              >
                {/* The ⚙ opens the gym's menu here: Name, Location, Directions pin, Delete gym (asks first). */}
                <ThunderGymMenu
                  gymId={g.id}
                  name={g.name}
                  address={g.address ?? null}
                  pinAddress={g.pinAddress ?? null}
                  openSlots={(use.get(g.name)?.upcoming ?? 0) - (use.get(g.name)?.booked ?? 0)}
                />
                <GymPlace gym={g} />
                <p className="text-xs text-zinc-500">
                  {use.get(g.name)?.upcoming ?? 0} upcoming slots · approved for {use.get(g.name)?.teams ?? 0} team
                  {use.get(g.name)?.teams === 1 ? "" : "s"}
                  {(use.get(g.name)?.booked ?? 0) > 0 && ` · ${use.get(g.name)!.booked} booked`}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {g.courts.map((c) => (
                    <Chip key={c.id} tone={c.active ? "blue" : "zinc"}>
                      {c.name}
                      {!c.active && " (inactive)"}
                    </Chip>
                  ))}
                </div>
                {calendars?.[g.id] && (
                  <div className="mt-4">
                    <p className="mb-2 text-sm font-semibold">Availability</p>
                    {calendars[g.id]}
                  </div>
                )}
              </SubCard>
            ))}
        </div>
      </PageFrame>
    </>
  );
}
