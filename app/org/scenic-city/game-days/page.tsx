import { Suspense } from "react";
import { GameDaysContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/game-days">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <GameDaysContent  />
    </Suspense>
  );
}
