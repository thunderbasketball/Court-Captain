import { Suspense } from "react";
import { PracticeContent } from "./content";

export default function Page({ searchParams }: PageProps<"/org/thunder/practice">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <PracticeContent searchParams={searchParams} />
    </Suspense>
  );
}
