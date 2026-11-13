import { redirect } from "next/navigation";
import { Suspense } from "react";
import { membersHref } from "@/lib/home-card-href";

// Members is a card on Thunder's Home, not its own page: old links open that card (and the part they named).
export default function Page({ searchParams }: PageProps<"/org/thunder/members">) {
  return (
    <Suspense fallback={null}>
      <Go searchParams={searchParams} />
    </Suspense>
  );
}

async function Go({ searchParams }: { searchParams: PageProps<"/org/thunder/members">["searchParams"] }) {
  redirect(membersHref("/org/thunder", await searchParams));
  return null;
}
