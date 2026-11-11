import { Suspense } from "react";
import { OrgTeamsContent } from "./content";

export default function Page({ params, searchParams }: PageProps<"/org/[slug]/teams">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgTeamsContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
