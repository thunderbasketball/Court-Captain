import { redirect } from "next/navigation";
import { Suspense } from "react";

// The practice week grid lives in cards now (SPEC.md section 14): the Director's on Home → Practice, a team's in its team
// page's Practices card (Full schedule). Old links open there, on the same week.
export default function Page({ searchParams }: PageProps<"/org/thunder/practice">) {
  return (
    <Suspense fallback={null}>
      <Go searchParams={searchParams} />
    </Suspense>
  );
}

async function Go({ searchParams }: { searchParams: PageProps<"/org/thunder/practice">["searchParams"] }) {
  const sp = await searchParams;
  const week = typeof sp.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.week) ? sp.week : null;
  const team = typeof sp.team === "string" && /^\d{1,18}$/.test(sp.team) ? sp.team : null;
  redirect(
    team
      ? `/org/thunder/teams/${team}?tab=practices${week ? `&week=${week}` : ""}`
      : `/org/thunder?open=schedule${week ? `&week=${week}` : ""}#schedule`,
  );
  return null;
}
