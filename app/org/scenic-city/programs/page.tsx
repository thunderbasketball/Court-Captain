import { Suspense } from "react";
import { ProgramsContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/programs">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ProgramsContent  />
    </Suspense>
  );
}
