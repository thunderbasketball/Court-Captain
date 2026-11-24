import { Suspense } from "react";
import PageOutline from "../../../../PageOutline";
import { HostingSitesMembersContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/members/hosting-sites">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <HostingSitesMembersContent  />
    </Suspense>
  );
}
