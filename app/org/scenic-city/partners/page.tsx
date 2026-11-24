import { Suspense } from "react";
import PageOutline from "../../../PageOutline";
import { PartnersContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/partners">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <PartnersContent  />
    </Suspense>
  );
}
