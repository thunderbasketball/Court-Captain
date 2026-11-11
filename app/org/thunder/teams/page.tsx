import { Suspense } from "react";
import { TeamsContent } from "./content";

export default function Page({ searchParams }: PageProps<"/org/thunder/teams">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <TeamsContent searchParams={searchParams} />
    </Suspense>
  );
}
