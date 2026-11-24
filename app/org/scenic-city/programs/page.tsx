import { Suspense } from "react";
import PageOutline from "../../../PageOutline";
import { ProgramsContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/programs">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <ProgramsContent  />
    </Suspense>
  );
}
