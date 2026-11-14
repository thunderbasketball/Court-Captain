import { Suspense } from "react";
import OrgHome from "../../OrgHome";

// Thunder's Home: the same page as every organization's (app/OrgHome.tsx).
export default function ThunderHomePage({ searchParams }: PageProps<"/org/thunder">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <OrgHome org="thunder" searchParams={searchParams} />
    </Suspense>
  );
}
