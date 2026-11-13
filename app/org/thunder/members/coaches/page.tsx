import { Suspense } from "react";
import { redirect } from "next/navigation";

// Members → coaches is a card on the Members page now: open it there.
export default function Page(props: PageProps<"/org/thunder/members/coaches">) {
  return (
    <Suspense fallback={null}>
      <Go searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Go({ searchParams }: { searchParams: PageProps<"/org/thunder/members/coaches">["searchParams"] }) {
  const view = (await searchParams).view;
  redirect(`/org/thunder?open=members&sub=coaches${typeof view === "string" ? `&coaches=${encodeURIComponent(view)}` : ""}#members`);
  return null;
}
