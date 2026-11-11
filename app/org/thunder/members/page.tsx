import { Suspense } from "react";
import { MembersContent } from "./content";

export default function Page({ searchParams }: PageProps<"/org/thunder/members">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <MembersContent searchParams={searchParams} />
    </Suspense>
  );
}
