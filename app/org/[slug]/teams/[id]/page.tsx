import { Suspense } from "react";
import { OrgTeamView } from "./view";

export default function OrgTeamPage({ params, searchParams }: PageProps<"/org/[slug]/teams/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Team params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Team({ params, searchParams }: PageProps<"/org/[slug]/teams/[id]">) {
  const { slug, id } = await params;
  return <OrgTeamView slug={slug} id={id} searchParams={searchParams} />;
}
