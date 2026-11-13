import { Suspense } from "react";
import { redirect } from "next/navigation";

// Members → requests is a card on the Members page now: open it there.
export default function Page(props: PageProps<"/org/thunder/members/requests">) {
  return (
    <Suspense fallback={null}>
      <Go searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Go({ searchParams }: { searchParams: PageProps<"/org/thunder/members/requests">["searchParams"] }) {
  const view = (await searchParams).view;
  redirect(`/org/thunder?open=members&sub=requests${typeof view === "string" ? `&coaches=${encodeURIComponent(view)}` : ""}#members`);
  return null;
}
