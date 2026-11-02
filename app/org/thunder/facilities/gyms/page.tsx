import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { listGyms } from "@/lib/practice/schedule";
import AppHeader from "../../../../AppHeader";
import { Chip, PageTitle, card } from "../../../../ui";
import FacilitiesNav from "../FacilitiesNav";
import { DeleteGymButton } from "./DeleteGymButton";
import { AddGymButton } from "../../practice/PracticeTools";
import ImportGymsButton from "../../../../ImportGyms";
import { hasArea } from "@/lib/org-admin";

export default function GymsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Gyms />
    </Suspense>
  );
}

async function Gyms() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (!hasArea(user, "facilities")) redirect("/");
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
      <AppHeader user={user} tab="facilities" context="director" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <PageTitle title="Gyms" subtitle="Thunder's gyms and their courts" />
          <div className="flex shrink-0 gap-2">
            <ImportGymsButton org="thunder" />
            <AddGymButton />
          </div>
        </div>
        <FacilitiesNav current="gyms" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {/* Removed gyms kept for their past practices are hidden; adding one with the same name brings it back. */}
          {gyms
            .filter((g) => g.active)
            .map((g) => (
              <section key={g.id} className={`${card} p-4`}>
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{g.name}</h2>
                  <DeleteGymButton
                    id={g.id}
                    name={g.name}
                    openSlots={(use.get(g.name)?.upcoming ?? 0) - (use.get(g.name)?.booked ?? 0)}
                  />
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {use.get(g.name)?.upcoming ?? 0} upcoming slots · approved for {use.get(g.name)?.teams ?? 0} team
                  {use.get(g.name)?.teams === 1 ? "" : "s"}
                  {(use.get(g.name)?.booked ?? 0) > 0 && ` · ${use.get(g.name)!.booked} booked`}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {g.courts.map((c) => (
                    <Chip key={c.id} tone={c.active ? "blue" : "zinc"}>
                      {c.name}
                      {!c.active && " (inactive)"}
                    </Chip>
                  ))}
                </div>
              </section>
            ))}
        </div>
      </main>
    </>
  );
}
