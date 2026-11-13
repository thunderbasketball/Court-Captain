import { redirect } from "next/navigation";
import { Suspense } from "react";
import { homeCardHref } from "@/lib/home-card-href";

// Teams is a card on the organization's Home, not its own page: this address opens that card.
export default function Page(props: PageProps<"/org/thunder/teams">) {
  return (
    <Suspense fallback={null}>
      <Go {...props} />
    </Suspense>
  );
}

async function Go({ searchParams }: PageProps<"/org/thunder/teams">) {
  redirect(homeCardHref("/org/thunder", "teams", await searchParams));
  return null;
}
