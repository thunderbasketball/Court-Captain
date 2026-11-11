import { Suspense } from "react";
import { CourtsContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/courts">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <CourtsContent  />
    </Suspense>
  );
}
