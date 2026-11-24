import { Suspense } from "react";
import { HeaderOutline, TeamOutline } from "../../../../PageOutline";
import { ThunderTeamView } from "./view";

export default function TeamPage({ params, searchParams }: PageProps<"/org/thunder/teams/[id]">) {
  return (
    <Suspense fallback={<><HeaderOutline /><TeamOutline /></>}>
      <Team params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Team({ params, searchParams }: PageProps<"/org/thunder/teams/[id]">) {
  const { id } = await params;
  return <ThunderTeamView id={id} searchParams={searchParams} />;
}
