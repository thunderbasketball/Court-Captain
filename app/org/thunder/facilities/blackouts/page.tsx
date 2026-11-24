import { Suspense } from "react";
import PageOutline from "../../../../PageOutline";
import { BlackoutsContent } from "./content";

export default function Page({  }: PageProps<"/org/thunder/facilities/blackouts">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <BlackoutsContent  />
    </Suspense>
  );
}
