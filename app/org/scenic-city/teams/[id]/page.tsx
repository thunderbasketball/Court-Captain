import { Suspense } from "react";
import { HeaderOutline, TeamOutline } from "../../../../PageOutline";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { currentScenic } from "@/lib/contexts-server";
import AppHeader from "../../../../AppHeader";
import { LeagueTeamView } from "./view";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

// A League team's own page (app/org/scenic-city/teams/[id]/view.tsx; also opened inside its row on the Teams list).
export default function LeagueTeamRoute(props: Props) {
  return (
    <Suspense fallback={<><HeaderOutline /><TeamOutline /></>}>
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
      <Suspense fallback={<HeaderOutline />}>
        <AppHeader user={user} context={scenic?.key ?? "scenic:Coach"} tab="scenic-teams" />
      </Suspense>
      <Suspense fallback={<TeamOutline />}>
        <LeagueTeamView id={id} opened={typeof sp.tab === "string" ? sp.tab : ""} />
      </Suspense>
    </>
  );
}
