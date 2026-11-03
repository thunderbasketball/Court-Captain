import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import { db } from "@/lib/db";
import { orgFeatures, type Feature } from "@/lib/features";
import { directorAreas, isOrgAdmin, type Area } from "@/lib/org-admin";
import AppHeader from "../../AppHeader";
import { card } from "../../ui";

export default function ScenicPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Scenic />
    </Suspense>
  );
}

// What Scenic City offers, by role and by the features it has (SPEC.md sections 13-14). Parts without a link come later.
// For the Director chip: `area` needs that Director area, `admin` needs an Admin (Admins have every area).
const PARTS: { title: string; about: string; who: string[]; href?: string; feature?: Feature; area?: Area; admin?: boolean }[] = [
  {
    title: "Teams",
    about: "Every team, by division or by organization; add or import outside clubs' teams.",
    who: ["Director", "Solo", "Coach"],
    href: "/org/scenic-city/teams",
    feature: "team-registration",
    area: "teams",
  },
  {
    title: "Programs",
    about: "League, Circuit and Tournament: divisions, game and bracket days, and registered teams.",
    who: ["Director", "Solo", "Coach"],
    href: "/org/scenic-city/programs",
    feature: "programs",
    area: "programs",
  },
  {
    title: "Game days",
    about: "The dates Scenic City plays, from each program (under Facilities).",
    who: ["Director", "Solo", "Coach"],
    href: "/org/scenic-city/game-days",
    feature: "hosting-partners",
  },
  {
    title: "Hosting Sites",
    about: "Organizations and schools that host games: their gyms, courts and open hours (under Facilities).",
    who: ["Director"],
    href: "/org/scenic-city/partners",
    feature: "hosting-partners",
    area: "facilities",
  },
  {
    title: "Members",
    about: "Staff and join requests, hosting sites' Owners and Admins, and each program's coaches.",
    who: ["Director"],
    href: "/org/scenic-city/users",
    admin: true,
  },
  {
    title: "Officials",
    about: "Referees and scorekeepers for your games.",
    who: ["Director"],
    feature: "officials",
    area: "officials",
  },
];

// Scenic City home: only for people who hold a Scenic City role (checked on the server).
async function Scenic() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const scenic = await currentScenic(user);
  if (!scenic) redirect("/");
  const features = await orgFeatures(db, "scenic-city");
  const director = scenic.role === "Director";
  const [admin, areas] = director
    ? await Promise.all([isOrgAdmin(db, user.coachId, "scenic-city"), directorAreas(db, user.coachId, "scenic-city")])
    : [false, [] as Area[]];
  const parts = PARTS.filter(
    (p) =>
      p.who.includes(scenic.role) &&
      (!p.feature || features.has(p.feature)) &&
      (!director || ((!p.area || areas.includes(p.area)) && (!p.admin || admin))),
  );
  const requests = admin
    ? (await db.query<{ n: number }>("select count(*)::int as n from access_requests where org = 'scenic-city'")).rows[0].n
    : 0;

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="scenic-home" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Welcome, {user.firstName} · {scenic.role}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {parts.map((p) => {
            const body = (
              <>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">{p.title}</h2>
                  {p.href ? (
                    p.title === "Members" &&
                    requests > 0 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
                        {requests} waiting
                      </span>
                    )
                  ) : (
                    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                      Coming soon
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{p.about}</p>
              </>
            );
            return p.href ? (
              <Link key={p.title} href={p.href} className={`${card} block p-4 hover:ring-scenic-navy/40`}>
                {body}
              </Link>
            ) : (
              <div key={p.title} className={`${card} p-4`}>
                {body}
              </div>
            );
          })}
        </div>
      </main>
    </>
  );
}
