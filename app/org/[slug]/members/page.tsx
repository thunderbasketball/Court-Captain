import { redirect } from "next/navigation";
import { Suspense } from "react";
import { membersHref } from "@/lib/home-card-href";

// Members is a card on the organization's Home, not its own page: old links open that card (and the part they named).
export default function Page({ params, searchParams }: PageProps<"/org/[slug]/members">) {
  return (
    <Suspense fallback={null}>
      <Go params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Go({ params, searchParams }: PageProps<"/org/[slug]/members">) {
  const { slug } = await params;
  redirect(membersHref(`/org/${encodeURIComponent(slug)}`, await searchParams));
  return null;
}
