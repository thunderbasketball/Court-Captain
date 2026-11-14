import { Suspense } from "react";
import OrgHome from "../../OrgHome";

// Every organization's Home (app/OrgHome.tsx), the same page for all.
export default function OrgHomePage({ params, searchParams }: PageProps<"/org/[slug]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Home params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ params, searchParams }: PageProps<"/org/[slug]">) {
  const { slug } = await params;
  return <OrgHome org={slug} searchParams={searchParams} />;
}
