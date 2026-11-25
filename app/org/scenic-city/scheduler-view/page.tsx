import { Suspense } from "react";
import PageOutline from "../../../PageOutline";
import { SchedulerView } from "../scheduler/content";

export default function Page({ searchParams }: PageProps<"/org/scenic-city/scheduler-view">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <SchedulerView searchParams={searchParams} />
    </Suspense>
  );
}
