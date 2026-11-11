import { Suspense } from "react";
import { redirect } from "next/navigation";

// Members → staff is a card on the Members page now: open it there.
export default function Page(props: PageProps<"/org/thunder/members/staff">) {
  return (
    <Suspense fallback={null}>
      <Go searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Go({ searchParams }: { searchParams: PageProps<"/org/thunder/members/staff">["searchParams"] }) {
  const view = (await searchParams).view;
  redirect(`/org/thunder/members?open=staff${typeof view === "string" ? `&coaches=${encodeURIComponent(view)}` : ""}`);
  return null;
}
