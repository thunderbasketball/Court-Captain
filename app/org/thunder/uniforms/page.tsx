import { redirect } from "next/navigation";
import { Suspense } from "react";
import { homeCardHref } from "@/lib/home-card-href";

// Uniforms is a card on the organization's Home, not its own page: this address opens that card.
export default function Page(props: PageProps<"/org/thunder/uniforms">) {
  return (
    <Suspense fallback={null}>
      <Go {...props} />
    </Suspense>
  );
}

async function Go({ searchParams }: PageProps<"/org/thunder/uniforms">) {
  redirect(homeCardHref("/org/thunder", "uniforms", await searchParams));
  return null;
}
