import { Suspense } from "react";
import Splash from "../../Splash";
import OrgHome from "../../OrgHome";

// Every organization's Home (app/OrgHome.tsx), the same page for all.
export default function OrgHomePage({ params, searchParams }: PageProps<"/org/[slug]">) {
  return (
    <Suspense fallback={<Splash />}>
      <Home params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Home({ params, searchParams }: PageProps<"/org/[slug]">) {
  const { slug } = await params;
  return <OrgHome org={slug} searchParams={searchParams} />;
}
