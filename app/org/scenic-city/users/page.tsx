import { Suspense } from "react";
import { ScenicUsersContent } from "./content";

export default function Page({  }: PageProps<"/org/scenic-city/users">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <ScenicUsersContent  />
    </Suspense>
  );
}
