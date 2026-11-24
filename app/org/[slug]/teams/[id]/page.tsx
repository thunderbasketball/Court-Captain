import { Suspense } from "react";
import { HeaderOutline, TeamOutline } from "../../../../PageOutline";
import { OrgTeamView } from "./view";

export default function OrgTeamPage({ params, searchParams }: PageProps<"/org/[slug]/teams/[id]">) {
  return (
    <Suspense fallback={<><HeaderOutline /><TeamOutline /></>}>
      <Team params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Team({ params, searchParams }: PageProps<"/org/[slug]/teams/[id]">) {
  const { slug, id } = await params;
  return <OrgTeamView slug={slug} id={id} searchParams={searchParams} />;
}
