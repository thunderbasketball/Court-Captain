import { Suspense } from "react";
import PageOutline from "../../../../PageOutline";
import { ProgramContent } from "./content";

export default function Page({ params }: PageProps<"/org/scenic-city/programs/[id]">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <ProgramContent params={params} />
    </Suspense>
  );
}
