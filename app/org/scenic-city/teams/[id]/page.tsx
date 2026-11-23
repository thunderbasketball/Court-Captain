import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import AppHeader from "../../../../AppHeader";
import { LeagueTeamView } from "./view";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// A League team's own page (app/org/scenic-city/teams/[id]/view.tsx; also opened inside its row on the Teams list).
export default function LeagueTeamRoute(props: Props) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <LeagueTeam {...props} />
    </Suspense>
  );
}

async function LeagueTeam({ params, searchParams }: Props) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const [{ id }, sp, scenic] = await Promise.all([params, searchParams, currentScenic(user)]);
  return (
    <>
      <AppHeader user={user} context={scenic?.key ?? "scenic:Coach"} tab="scenic-teams" />
      <LeagueTeamView id={id} opened={typeof sp.tab === "string" ? sp.tab : ""} />
    </>
  );
}
