import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { orgFeatures } from "@/lib/features";
import { hasArea, isThunderAdmin } from "@/lib/org-admin";
import AppHeader from "../AppHeader";
import { card } from "../ui";

export default function ThunderHomePage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ThunderHome />
    </Suspense>
  );
}

// Thunder's Home (SPEC.md section 14), the same layout as every organization's: "Welcome, name · role", then a card for
// each part this Director can open (the same parts as the tabs, in the same order). Name and logo are in the header.
async function ThunderHome() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (!user.isDirector) redirect("/");
  const features = await orgFeatures(db, "thunder");
  const admin = isThunderAdmin(user);
  const owner = admin && (await db.query("select acts_as($1, 'thunder', 'Owner') as ok", [user.coachId])).rows[0].ok;
  const schedule =
    features.has("practice") && hasArea(user, "facilities")
      ? "/practice"
      : features.has("events") && hasArea(user, "programs")
        ? "/events"
        : null;
  const parts = [
    ...(features.has("team-building") && hasArea(user, "teams")
      ? [{ title: "Teams", about: "Every team: staff, rosters, uniforms and practices; add or import teams.", href: "/teams" }]
      : []),
    ...(schedule ? [{ title: "Schedule", about: "Practice slots, the season and events.", href: schedule }] : []),
    ...(features.has("uniforms") && hasArea(user, "players")
      ? [{ title: "Uniforms", about: "Numbers and sizes for every rostered player.", href: "/uniforms" }]
      : []),
    ...(hasArea(user, "facilities")
      ? [{ title: "Facilities", about: "Gyms, their availability, blackouts and hosting leagues' games.", href: "/facilities" }]
      : []),
    ...(admin || hasArea(user, "coaches", "players", "teams")
      ? [{ title: "Members", about: "Staff, coaches, players and families.", href: "/members" }]
      : []),
  ];

  return (
    <>
      <AppHeader user={user} context="director" tab="thunder-home" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
          Welcome, {user.firstName} · {owner ? "Owner" : admin ? "Admin" : "Director"}
        </p>
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
