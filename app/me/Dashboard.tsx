import Link from "next/link";
import { notFound } from "next/navigation";
import type { SessionUser } from "@/lib/auth/service";
import { gradeLabel } from "@/lib/grades";
import { myDashboard } from "@/lib/me";
import { formatCell } from "@/lib/phone";
import { TZ } from "@/lib/time";
import AppHeader from "../AppHeader";
import { Chip, EmailLink, PageTitle, PhoneLink, card } from "../ui";

const when = (d: Date) =>
  d.toLocaleString("en-US", {
    timeZone: TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

// A person's dashboard (SPEC.md section 15): about them, their players (their family from registration) and their
// teams, in every organization. The pages check who may see it: the person, or an Admin of their organization.
export default async function Dashboard({ user, coachId }: { user: SessionUser; coachId: string }) {
  const d = await myDashboard(coachId);
  if (!d) notFound();
  const own = coachId === user.coachId;
  const h2 = "mb-2 text-sm font-semibold tracking-wide text-zinc-500 uppercase";

  return (
    <>
      <AppHeader user={user} />
      <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 px-4 py-6">
        <PageTitle title={d.name} subtitle={own ? "Your dashboard" : "Their dashboard (as an Admin sees it)"} />

        <section className={`${card} space-y-2 p-4 text-sm`}>
          <h2 className={h2}>{own ? "About you" : "About them"}</h2>
          <p>
            <PhoneLink cell={d.cell} label={formatCell(d.cell)} />
          </p>
          <p>
            {d.email ? <EmailLink email={d.email} /> : "No email"}
            {d.email &&
              (d.verified ? <span className="text-emerald-600 dark:text-emerald-400"> ✓ verified</span> : " · not verified")}
          </p>
          {d.roles.length > 0 ? (
            <ul className="divide-y divide-zinc-100 pt-1 dark:divide-white/5">
              {d.roles.map((r) => (
                <li key={r.org} className="flex items-start justify-between gap-3 py-2">
                  <span className="shrink-0 text-sm font-medium">{r.org}</span>
                  <span className="flex flex-wrap justify-end gap-1.5">
                    {r.labels.map((l) => (
                      <Chip key={l} tone="blue">
                        {l}
                      </Chip>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-zinc-500">No roles yet.</p>
          )}
        </section>

        <section>
          <h2 className={h2}>
            {own ? "Your" : "Their"} players{d.family ? ` · ${d.family.name}` : ""}
          </h2>
          {d.family?.children.length ? (
            <ul className="space-y-2">
              {d.family.children.map((c) => (
                <li key={c.name} className={`${card} flex items-center justify-between gap-3 p-4`}>
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-sm text-zinc-500">
                      {c.gender} · {gradeLabel(c.grade)}
                      {(c.uniformSize || c.uniformNumber) &&
                        ` · uniform ${[c.uniformSize, c.uniformNumber && `#${c.uniformNumber}`].filter(Boolean).join(" ")}`}
                    </p>
                  </div>
                  <span className="text-sm font-medium">{c.team ?? <span className="text-zinc-500">Team not set yet</span>}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No registered players with your cell number.</p>
          )}
          {d.family?.fees && d.family.fees.remaining > 0 && (
            <p className="mt-2 text-sm font-medium text-amber-700 dark:text-amber-300">
              Registration fees: ${d.family.fees.remaining.toFixed(2)} still owed.
            </p>
          )}
        </section>

        <section>
          <h2 className={h2}>{own ? "Your" : "Their"} teams</h2>
          {d.teams.length || d.scenicTeams.length || d.partners.length ? (
            <ul className="space-y-2">
              {d.teams.map((t) => (
                <li key={t.id + t.role}>
                  <Link
                    href={`/teams/${t.id}`}
                    className={`${card} flex items-center justify-between gap-3 p-4 hover:ring-thunder-blue/40`}
                  >
                    <div>
                      <p className="font-semibold">{t.name}</p>
                      <p className="text-sm text-zinc-500">
                        {t.next ? `Next practice ${when(t.next)}${t.gym ? ` · ${t.gym}` : ""}` : "No practices booked"}
                      </p>
                    </div>
                    <Chip tone="orange">{t.role}</Chip>
                  </Link>
                </li>
              ))}
              {d.scenicTeams.map((t) => (
                <li key={`sc-${t.name}`} className={`${card} flex items-center justify-between gap-3 p-4`}>
                  <div>
                    <p className="font-semibold">{t.name}</p>
                    <p className="text-sm text-zinc-500">Scenic City</p>
                  </div>
                  <Chip tone="blue">{t.how}</Chip>
                </li>
              ))}
              {d.partners.map((p) => (
                <li key={`p-${p}`} className={`${card} flex items-center justify-between gap-3 p-4`}>
                  <div>
                    <p className="font-semibold">{p}</p>
                    <p className="text-sm text-zinc-500">Scenic City partner</p>
                  </div>
                  <Chip tone="blue">Contact</Chip>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">You&apos;re not on a team&apos;s staff yet.</p>
          )}
        </section>
      </main>
    </>
  );
}
