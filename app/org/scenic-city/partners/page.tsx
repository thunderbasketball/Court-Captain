import { Suspense } from "react";
import { PartnersContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/partners">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <PartnersContent  />
    </Suspense>
  );
}
