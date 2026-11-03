import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { orgFeatures } from "@/lib/features";
import { hasArea, isThunderAdmin } from "@/lib/org-admin";
import { orgMetrics } from "@/lib/org-metrics";
import { visitStats } from "@/lib/site-visits";
import AppHeader from "../../AppHeader";
import OrgMetrics from "../../OrgMetrics";
import { card } from "../../ui";

export default function ThunderHomePage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ThunderHome />
    </Suspense>
  );
}

// Thunder's Home (SPEC.md section 14), the same layout as every organization's: "Welcome, name · role", the metrics for
// Owners and Admins, then a card for
// each part this Director can open (the same parts as the tabs, in the same order). Name and logo are in the header.
async function ThunderHome() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (!user.isDirector) redirect("/");
  const features = await orgFeatures(db, "thunder");
  const admin = isThunderAdmin(user);
  const owner = admin && (await db.query("select acts_as($1, 'thunder', 'Owner') as ok", [user.coachId])).rows[0].ok;
  // Owners and Admins: the organization's metrics above the cards.
  const now = new Date();
  const [metrics, visits] = admin
    ? await Promise.all([
        orgMetrics({ pool: db, now: () => now }, user, "thunder"),
        visitStats({ pool: db, now: () => now }, user, "thunder"),
      ])
    : [null, null];
  const schedule =
    features.has("practice") && hasArea(user, "practices")
      ? "/org/thunder/practice"
      : features.has("events") && hasArea(user, "events")
        ? "/events"
        : null;
  const parts = [
    ...(features.has("team-building") && hasArea(user, "teams")
      ? [
          {
            title: "Teams",
            about: "Every team: staff, rosters, uniforms and practices; add or import teams.",
            href: "/org/thunder/teams",
          },
        ]
      : []),
    ...(schedule ? [{ title: "Schedule", about: "Practice slots, the season and events.", href: schedule }] : []),
    ...(features.has("uniforms") && hasArea(user, "uniforms")
      ? [{ title: "Uniforms", about: "Numbers and sizes for every rostered player.", href: "/org/thunder/uniforms" }]
      : []),
    ...(hasArea(user, "facilities", "practices")
      ? [
          {
            title: "Facilities",
            about: "Gyms, their availability, blackouts and hosting leagues' games.",
            href: "/org/thunder/facilities",
          },
        ]
      : []),
    ...(admin || hasArea(user, "teams", "players")
      ? [{ title: "Members", about: "Staff, coaches, players and families.", href: "/org/thunder/members" }]
      : []),
  ];

  return (
    <>
      <AppHeader user={user} context="director" tab="thunder-home" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Welcome, {user.firstName} · {owner ? "Owner" : admin ? "Admin" : "Director"}
        </p>
        {metrics && <OrgMetrics m={metrics} visits={visits} base="/org/thunder" thunder now={now} />}
        {!parts.length && <p className="text-sm text-zinc-500">No areas yet. An Admin gives Directors their areas.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          {parts.map((p) => (
            <Link key={p.title} href={p.href} className={`${card} block p-4 hover:ring-zinc-400/40`}>
              <h2 className="font-semibold">{p.title}</h2>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{p.about}</p>
            </Link>
          ))}
        </div>
      </main>
    </>
  );
}
