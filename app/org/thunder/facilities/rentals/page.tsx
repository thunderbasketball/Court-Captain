import { Suspense } from "react";
import PageOutline from "../../../../PageOutline";
import { RentalsContent } from "./content";

export default function Page({  }: PageProps<"/org/thunder/facilities/rentals">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <RentalsContent  />
    </Suspense>
  );
}
