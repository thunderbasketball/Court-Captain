import { Suspense } from "react";
import PageOutline from "../../../PageOutline";
import { ScenicUsersContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/users">) {
  return (
    <Suspense fallback={<PageOutline />}>
      <ScenicUsersContent  />
    </Suspense>
  );
}
