import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentContexts } from "@/lib/contexts-server";
import AppHeader from "./AppHeader";
import Link from "next/link";
import { Notice, card } from "./ui";

// Home: go to the role the person used last (Director → Teams, or one of their teams).
export default function Home() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <HomeContent />
    </Suspense>
  );
}

async function HomeContent() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const { active } = await currentContexts(user);
  if (active) redirect(active.href);
  // A family (no team role) lands on their dashboard: their players and teams.
  if (user.isFamily && !user.hasThunderRole) redirect("/me");

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        {user.hasThunderRole ? (
          <Notice tone="green">You&apos;re not on a team yet. The Director will add you.</Notice>
        ) : user.requestPending ? (
          <Notice tone="green">Request pending. The Director will review it.</Notice>
        ) : (
          <GetStarted firstName={user.firstName} />
        )}
      </main>
    </>
  );
}

// A CourtCaptain account with no organization yet: start an organization (a group of teams), a stand-alone team, or a
// hosting program.
function GetStarted({ firstName }: { firstName: string }) {
  const choices = [
    {
      href: "/register",
      title: "Start an organization",
      about: "A group of teams: a club, school or league on CourtCaptain. You'll be its Owner.",
    },
    {
      href: "/login/scenic-city",
      title: "Register a stand-alone team",
      about: "A team of your own (CourtSolo): pick an event and tap Register, then One team.",
    },
    {
      href: "/register?need=court-sync",
      title: "Start a hosting program",
      about: "Offer your gyms to host leagues' games: register with CourtSync.",
    },
  ];  return (
    <section className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Welcome to CourtCaptain, {firstName}</h1>
        <p className="text-sm text-zinc-500">What would you like to do?</p>
      </div>
      <ul className="grid gap-3 sm:grid-cols-2">
        {choices.map((c) => (
          <li key={c.href}>
            <Link href={c.href} className={`${card} block h-full p-4 hover:ring-thunder-blue/40`}>
              <p className="font-semibold">{c.title} →</p>
              <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">{c.about}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
