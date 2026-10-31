import { Suspense } from "react";
import Image from "next/image";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { ORGS } from "@/lib/orgs";
import { AREAS } from "@/lib/org-admin";
import { platformOverview } from "@/lib/platform";
import { TZ } from "@/lib/time";
import AppHeader from "../AppHeader";
import { card, PageTitle } from "../ui";
import { AddOwner, FeatureSwitch, RemoveOwner } from "./PlatformTools";

const AREA_NAMES = Object.fromEntries(AREAS.map((a) => [a.key, a.name])) as Record<string, string>;

export default function PlatformPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Platform />
    </Suspense>
  );
}

// CourtCaptain's own page (SPEC.md section 14): CourtCaptain Admins only. Every organization, its features and Directors.
async function Platform() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const data = await platformOverview({ pool: db, now: () => new Date() }, user);
  if (!data) redirect("/");
  const date = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: TZ });
  const how: Record<string, string> = { setup: "set up", comp: "free", purchase: "bought" };

  return (
    <>
      <AppHeader user={user} context="platform" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <PageTitle
          title="CourtCaptain"
          subtitle={`${data.orgs.length} organizations · CourtCaptain Admins: ${data.platformAdmins.map((a) => a.name).join(", ")}`}
        />
        <div className="grid gap-5">
          {data.orgs.map((o) => (
            <section key={o.slug} className={`${card} p-4`}>
              <div className="mb-4 flex items-center gap-3">
                <Image
                  src={ORGS[o.slug].logo.src}
                  alt=""
                  width={ORGS[o.slug].logo.width}
                  height={ORGS[o.slug].logo.height}
                  className="size-10 rounded-lg"
                />
                <div className="min-w-0">
                  <h2 className="font-semibold">{o.name}</h2>
                  <p className="text-xs text-zinc-500">Login link: {ORGS[o.slug].login}</p>
                </div>
              </div>

              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Owners</h3>
              <div className="mb-4 flex flex-wrap items-center gap-2">
                {o.owners.map((d) => (
                  <span
                    key={d.id}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-100 py-0.5 pr-1 pl-3 text-sm dark:bg-zinc-800"
                  >
                    {d.name}
                    <RemoveOwner org={o.slug} orgName={o.name} coachId={d.id} name={d.name} />
                  </span>
                ))}
                {o.owners.length === 0 && <span className="text-sm text-red-600">None yet: add one.</span>}
                <AddOwner org={o.slug} options={o.options} />
              </div>

              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Admins</h3>
              <p className="mb-4 text-sm">
                {o.admins.length ? (
                  o.admins.map((a) => a.name).join(", ")
                ) : (
                  <span className="text-zinc-500">None besides the Owners.</span>
                )}
              </p>

              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Directors</h3>
              <ul className="mb-4 text-sm">
                {o.directors.map((d) => (
                  <li key={d.id} className="py-0.5">
                    <span className="font-medium">{d.name}</span>
                    <span className="text-zinc-500">
                      {" "}
                      · {d.areas.length ? d.areas.map((a) => AREA_NAMES[a]).join(", ") : "no areas yet"}
                    </span>
                  </li>
                ))}
                {o.directors.length === 0 && <li className="text-zinc-500">None besides the Admins.</li>}
              </ul>
              <p className="-mt-3 mb-4 text-xs text-zinc-500">
                Owners choose Admins and Admins choose Directors, on the organization&apos;s Users page.
              </p>

              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                Features ({o.features.filter((f) => f.on).length} on)
              </h3>
              <ul className="divide-y divide-zinc-950/5 dark:divide-white/10">
                {o.features.map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <p className={`text-sm font-medium ${f.on ? "" : "text-zinc-500"}`}>{f.name}</p>
                      <p className="text-xs text-zinc-500">
                        {f.always
                          ? "Comes with every organization"
                          : f.since
                            ? `On since ${date(f.since)} (${how[f.source ?? ""] ?? f.source})`
                            : "Off"}
                      </p>
                    </div>
                    {!f.always && <FeatureSwitch org={o.slug} orgName={o.name} feature={f.key} name={f.name} on={f.on} />}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="mt-4 text-xs text-zinc-500">
          New admins: <code>npm run user -- admin &lt;cell&gt;</code>. Adding a new organization comes later.
        </p>
      </main>
    </>
  );
}
