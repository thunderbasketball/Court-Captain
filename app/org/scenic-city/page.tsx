import { Suspense } from "react";
import Splash from "../../Splash";
import OrgHome from "../../OrgHome";

// Scenic City's Home: the same page as every organization's (app/OrgHome.tsx).
export default function ScenicPage({ searchParams }: PageProps<"/org/scenic-city">) {
  return (
    <Suspense fallback={<Splash />}>
      <OrgHome org="scenic-city" searchParams={searchParams} />
    </Suspense>
  );
}
