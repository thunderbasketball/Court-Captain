import { Suspense } from "react";
import { ScenicCoachesContent } from "./content";

export default function Page({ searchParams }: PageProps<"/org/scenic-city/members/coaches">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ScenicCoachesContent searchParams={searchParams} />
    </Suspense>
  );
}
