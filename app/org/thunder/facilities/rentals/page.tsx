import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { hasArea } from "@/lib/org-admin";
import AppHeader from "../../../../AppHeader";
import { PageTitle, card } from "../../../../ui";
import FacilitiesNav from "../FacilitiesNav";

export default function RentalsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Rentals />
    </Suspense>
  );
}

// Facilities → Rentals (CourtFacility; Admins and Directors of Facilities): a placeholder until gym rentals are built
// (list gyms for rent, and teams rent them; SPEC.md section 14).
async function Rentals() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("thunder", "practice");
  if (!hasArea(user, "facilities", "practices")) redirect("/");
  return (
    <>
      <AppHeader user={user} tab="facilities" context="director" />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
        <PageTitle title="Gym rentals" subtitle="Rent your gyms to teams" />
        <FacilitiesNav current="rentals" />
        <section className={`${card} p-5`}>
          <p className="font-semibold">Coming soon</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
            List your gyms and open times for rent, and let teams book and rent them.
          </p>
        </section>
      </main>
    </>
  );
}
