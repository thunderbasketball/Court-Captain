import { Suspense } from "react";
import PageOutline from "../PageOutline";
import { EventsContent } from "./content";

export default function Page({ searchParams }: PageProps<"/events">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <EventsContent searchParams={searchParams} />
    </Suspense>
  );
}
