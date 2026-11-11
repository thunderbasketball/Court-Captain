import { Suspense } from "react";
import { EventsContent } from "./content";

export default function Page({ searchParams }: PageProps<"/events">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <EventsContent searchParams={searchParams} />
    </Suspense>
  );
}
