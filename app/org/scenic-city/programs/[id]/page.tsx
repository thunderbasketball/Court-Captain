import { Suspense } from "react";
import { ProgramContent } from "./content";

export default function Page({ params }: PageProps<"/org/scenic-city/programs/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ProgramContent params={params} />
    </Suspense>
  );
}
