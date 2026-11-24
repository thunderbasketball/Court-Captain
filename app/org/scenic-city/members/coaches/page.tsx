import { Suspense } from "react";
import PageOutline from "../../../../PageOutline";
import { ScenicCoachesContent } from "./content";

export default function Page({ searchParams }: PageProps<"/org/scenic-city/members/coaches">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <ScenicCoachesContent searchParams={searchParams} />
    </Suspense>
  );
}
