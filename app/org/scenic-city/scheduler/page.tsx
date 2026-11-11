import { Suspense } from "react";
import { SchedulerContent } from "./content";

export default function Page({ searchParams }: PageProps<"/org/scenic-city/scheduler">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <SchedulerContent searchParams={searchParams} />
    </Suspense>
  );
}
