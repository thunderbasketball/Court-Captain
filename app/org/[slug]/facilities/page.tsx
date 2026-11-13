import { redirect } from "next/navigation";
import { Suspense } from "react";
import { homeCardHref } from "@/lib/home-card-href";

// Facilities is a card on the organization's Home, not its own page: this address opens that card.
export default function Page(props: PageProps<"/org/[slug]/facilities">) {
  return (
    <Suspense fallback={null}>
      <Go {...props} />
    </Suspense>
  );
}

async function Go({ params, searchParams }: PageProps<"/org/[slug]/facilities">) {
  const { slug } = await params;
  redirect(homeCardHref(`/org/${encodeURIComponent(slug)}`, "facilities", await searchParams));
  return null;
}
