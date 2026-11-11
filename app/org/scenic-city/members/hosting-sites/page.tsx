import { Suspense } from "react";
import { HostingSitesMembersContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/members/hosting-sites">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <HostingSitesMembersContent  />
    </Suspense>
  );
}
