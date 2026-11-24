import { Suspense } from "react";
import PageOutline from "../../../PageOutline";
import { SchedulerContent } from "./content";

export default function Page({ searchParams }: PageProps<"/org/scenic-city/scheduler">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <SchedulerContent searchParams={searchParams} />
    </Suspense>
  );
}
