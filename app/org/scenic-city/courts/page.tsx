import { Suspense } from "react";
import PageOutline from "../../../PageOutline";
import { CourtsContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/courts">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <CourtsContent  />
    </Suspense>
  );
}
