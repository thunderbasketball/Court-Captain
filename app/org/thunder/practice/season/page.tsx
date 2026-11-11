import { Suspense } from "react";
import { SeasonContent } from "./content";

export default function Page({  }: PageProps<"/org/thunder/practice/season">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <SeasonContent  />
    </Suspense>
  );
}
