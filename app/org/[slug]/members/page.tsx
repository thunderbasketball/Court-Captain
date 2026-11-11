import { Suspense } from "react";
import { OrgMembersContent } from "./content";

export default function Page({ params, searchParams }: PageProps<"/org/[slug]/members">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgMembersContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}
