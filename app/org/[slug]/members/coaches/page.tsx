import { Suspense } from "react";
import { redirect } from "next/navigation";

// Members → coaches is a card on the Members page now: open it there.
export default function Page(props: PageProps<"/org/[slug]/members/coaches">) {
  return (
    <Suspense fallback={null}>
      <Go params={props.params} searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Go({
  params,
  searchParams,
}: {
  params: PageProps<"/org/[slug]/members/coaches">["params"];
  searchParams: PageProps<"/org/[slug]/members/coaches">["searchParams"];
}) {
  const { slug } = await params;
  const view = (await searchParams).view;
  redirect(`/org/${slug}/members?open=coaches${typeof view === "string" ? `&coaches=${encodeURIComponent(view)}` : ""}`);
  return null;
}
