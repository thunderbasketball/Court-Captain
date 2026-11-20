import { Suspense } from "react";
import Splash from "../../Splash";
import OrgHome from "../../OrgHome";

// Thunder's Home: the same page as every organization's (app/OrgHome.tsx).
export default function ThunderHomePage({ searchParams }: PageProps<"/org/thunder">) {
  return (
    <Suspense fallback={<Splash />}>
      <OrgHome org="thunder" searchParams={searchParams} />
    </Suspense>
  );
}
