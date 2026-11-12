import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { hasArea } from "@/lib/org-admin";
import { db } from "@/lib/db";
import AppHeader from "../../../../AppHeader";
import { PageTitle, card } from "../../../../ui";
import FacilitiesNav from "../FacilitiesNav";

import { PageFrame } from "../../../../ui";
import { hasFeature } from "@/lib/features";

// Facilities → Rentals (CourtFacility; Admins and Directors of Facilities): a placeholder until gym rentals are built
// (list gyms for rent, and teams rent them; SPEC.md section 14).
export async function RentalsContent({
  embedded = false,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "thunder", "practice"))) return null;
  } else await requireFeature("thunder", "practice");
  if (!hasArea(user, "facilities", "practices")) {
    if (embedded) return null;
    redirect("/");
  }
  return (
    <>
      {!embedded && <AppHeader user={user} tab="facilities" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        {!embedded && <PageTitle title="Gym rentals" subtitle="Rent your gyms to teams" />}
        {!embedded && <FacilitiesNav current="rentals" />}
        <section className={`${card} p-5`}>
          <p className="font-semibold">Coming soon</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            List your gyms and open times for rent, and let teams book and rent them.
          </p>
        </section>
      </PageFrame>
    </>
  );
}
