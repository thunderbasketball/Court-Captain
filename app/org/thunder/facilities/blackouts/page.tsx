import { Suspense } from "react";
import { BlackoutsContent } from "./content";

export default function Page({  }: PageProps<"/org/thunder/facilities/blackouts">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <BlackoutsContent  />
    </Suspense>
  );
}
