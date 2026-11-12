import { Suspense } from "react";
import { GymsContent } from "./content";

export default function Page({  }: PageProps<"/org/thunder/facilities/gyms">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <GymsContent  />
    </Suspense>
  );
}
