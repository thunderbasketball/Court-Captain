import { Suspense } from "react";
import { OrgFacilitiesContent } from "./content";

export default function Page({ params }: PageProps<"/org/[slug]/facilities">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgFacilitiesContent params={params} />
    </Suspense>
  );
}
