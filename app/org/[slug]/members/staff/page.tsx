import { Suspense } from "react";
import { redirect } from "next/navigation";

// Members → staff is a card on the Members page now: open it there.
export default function Page(props: PageProps<"/org/[slug]/members/staff">) {
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
  params: PageProps<"/org/[slug]/members/staff">["params"];
  searchParams: PageProps<"/org/[slug]/members/staff">["searchParams"];
}) {
  const { slug } = await params;
  const view = (await searchParams).view;
  redirect(`/org/${slug}/members?open=staff${typeof view === "string" ? `&coaches=${encodeURIComponent(view)}` : ""}`);
  return null;
}
