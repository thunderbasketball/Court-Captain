import { Suspense } from "react";
import { ScenicTeamsContent } from "./content";

export default function Page({ searchParams }: PageProps<"/org/scenic-city/teams">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ScenicTeamsContent searchParams={searchParams} />
    </Suspense>
  );
}
