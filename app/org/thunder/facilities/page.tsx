import { redirect } from "next/navigation";
import { Suspense } from "react";
import { homeCardHref } from "@/lib/home-card-href";

// Facilities is a card on the organization's Home, not its own page: this address opens that card.
export default function Page(props: PageProps<"/org/thunder/facilities">) {
  return (
    <Suspense fallback={null}>
      <Go {...props} />
    </Suspense>
  );
}

async function Go({ searchParams }: PageProps<"/org/thunder/facilities">) {
  redirect(homeCardHref("/org/thunder", "facilities", await searchParams));
  return null;
}
