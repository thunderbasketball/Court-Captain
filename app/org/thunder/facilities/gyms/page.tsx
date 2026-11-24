import { Suspense } from "react";
import PageOutline from "../../../../PageOutline";
import { GymsContent } from "./content";

export default function Page({  }: PageProps<"/org/thunder/facilities/gyms">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <GymsContent  />
    </Suspense>
  );
}
