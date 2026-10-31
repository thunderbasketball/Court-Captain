import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { db } from "@/lib/db";
import { currentScenic } from "@/lib/contexts-server";
import { contactOptions, getPartner, partnerHours } from "@/lib/scenic-partners";
import { localParts } from "@/lib/time";
import AppHeader from "../../../AppHeader";
import { Chip, PageTitle, card } from "../../../ui";
import { PartnerButton } from "../PartnerEditor";
import { AddContact, RemoveContact } from "./ContactTools";
import GymAvailability from "./GymAvailability";
import { AddCourt, GymButton, RemoveCourt } from "./GymTools";

export default function PartnerPage({ params }: PageProps<"/scenic/partners/[id]">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Partner params={params} />
    </Suspense>
  );
}

// One partner: details, contacts, gym availability, gyms and courts. Shown as the Scenic City chip in use: the Director chip
// edits the partner and its contacts; only the partner's own contacts enter gym availability.
async function Partner({ params }: { params: PageProps<"/scenic/partners/[id]">["params"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  await requireFeature("scenic-city", "hosting-partners");
  const { id } = await params;
  const deps = { pool: db, now: () => new Date() };
  const scenic = await currentScenic(user);
  const asDirector = scenic?.role === "Director";
  const [p, h] = await Promise.all([getPartner(deps, user, id, asDirector), partnerHours(deps, user, id)]);
  if (!p || !h || !scenic) notFound();
  const options = p.canEditPartner ? await contactOptions(deps, user, p.id) : [];
  const t = localParts(new Date());
  const today = `${t.year}-${String(t.month).padStart(2, "0")}-${String(t.day).padStart(2, "0")}`;

  return (
    <>
      <AppHeader user={user} context={scenic.key} tab="partners" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <Link href="/scenic/partners" className="text-sm text-zinc-500 hover:underline">
          ← Partners
        </Link>
        <div className="flex items-start justify-between gap-3">
          <PageTitle
            title={p.name}
            subtitle={`${p.kind} · ${[p.hostsGames && "Hosting games", p.registersTeams && "Registering teams"].filter(Boolean).join(" · ")}`}
          />
          {p.canEditPartner && <PartnerButton partner={p} />}
        </div>
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          {!p.approved && <Chip tone="amber">Not approved</Chip>}
          <span className="text-zinc-500">Contacts:</span>
          {p.contacts.map((c) =>
            p.canEditPartner ? (
              <span
                key={c.id}
                className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-3 text-sm dark:bg-zinc-800"
              >
                {c.name}
                <RemoveContact partnerId={p.id} coachId={c.id} name={c.name} partnerName={p.name} />
              </span>
            ) : (
              <Chip key={c.id}>{c.name}</Chip>
            ),
          )}
          {!p.contacts.length && <span className="text-zinc-500">none yet</span>}
          {p.canEditPartner && <AddContact partnerId={p.id} options={options} />}
        </div>

        <section className={`${card} mb-6 p-4`}>
          <h2 className="text-lg font-semibold">Gym availability</h2>
          <p className="mb-4 text-sm text-zinc-500">
            {p.managedBy
              ? `The game days ${p.managedBy}'s gyms are open for Partner Games, set in ${p.managedBy}'s Facilities. Each gym hosts as a whole gym.`
              : p.canEnterHours
                ? "Tap the game days your courts are open, pick the times (9 AM–10 PM, Eastern), then Submit."
                : `When ${p.name}'s courts are open on game days. Only ${p.name}'s contacts can enter this.`}
          </p>
          {h.courts.length ? (
            <GymAvailability
              partnerId={p.id}
              today={today}
              courts={h.courts}
              days={h.days}
              hours={h.hours}
              editable={p.canEnterHours}
            />
          ) : (
            <p className="text-zinc-500">{p.canEditGyms ? "Add a gym and its courts below first." : "No courts yet."}</p>
          )}
        </section>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Gyms &amp; courts</h2>
          {p.canEditGyms && <GymButton partnerId={p.id} />}
        </div>
        {p.managedBy && <p className="mb-3 text-sm text-zinc-500">{p.managedBy}&apos;s own gyms, managed in its Facilities.</p>}
        {!p.gymList.length && (
          <p className="text-zinc-500">
            {p.hostsGames ? "No gyms yet. Add the gyms where you can host Scenic City games." : "No gyms yet."}
          </p>
        )}
        <ul className="space-y-3">
          {p.gymList.map((g) => (
            <li key={g.id} className={`${card} p-4`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold">{g.name}</h3>
                  {g.address && <p className="text-sm text-zinc-500">{g.address}</p>}
                </div>
                {p.canEditGyms && <GymButton partnerId={p.id} gym={g} />}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {g.courts.map((c) => (
                  <span
                    key={c.id}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-1 pr-1 pl-3 text-sm dark:bg-zinc-800"
                  >
                    {c.name}
                    {p.canEditGyms && <RemoveCourt id={c.id} label={`${g.name} ${c.name}`} />}
                  </span>
                ))}
                {p.canEditGyms && <AddCourt gymId={g.id} suggestion={`Court ${g.courts.length + 1}`} />}
              </div>
              {!g.courts.length && !p.managedBy && <p className="mt-2 text-xs text-zinc-500">Add at least one court.</p>}
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
