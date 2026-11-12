import { Suspense } from "react";
import { RentalsContent } from "./content";

export default function Page({  }: PageProps<"/org/thunder/facilities/rentals">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <RentalsContent  />
    </Suspense>
  );
}
