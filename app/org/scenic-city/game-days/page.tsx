import { Suspense } from "react";
import PageOutline from "../../../PageOutline";
import { GameDaysContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/game-days">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <GameDaysContent  />
    </Suspense>
  );
}
