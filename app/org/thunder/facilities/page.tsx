import { Suspense } from "react";
import { FacilitiesContent } from "./content";

export default function Page({  }: PageProps<"/org/thunder/facilities">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <FacilitiesContent  />
    </Suspense>
  );
}
