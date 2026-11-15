import { Suspense } from "react";
import { ThunderTeamView } from "./view";

export default function TeamPage({ params, searchParams }: PageProps<"/org/thunder/teams/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Team params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Team({ params, searchParams }: PageProps<"/org/thunder/teams/[id]">) {
  const { id } = await params;
  return <ThunderTeamView id={id} searchParams={searchParams} />;
}
