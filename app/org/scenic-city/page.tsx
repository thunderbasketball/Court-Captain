import { Suspense } from "react";
import OrgHome from "../../OrgHome";

// Scenic City's Home: the same page as every organization's (app/OrgHome.tsx).
export default function ScenicPage({ searchParams }: PageProps<"/org/scenic-city">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgHome org="scenic-city" searchParams={searchParams} />
    </Suspense>
  );
}
