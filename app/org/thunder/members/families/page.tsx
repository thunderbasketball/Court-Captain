import { Suspense } from "react";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { listFamilies, type Family } from "@/lib/families";
import { ordinal } from "@/lib/grades";
import { hasArea } from "@/lib/org-admin";
import { formatCell } from "@/lib/phone";
import { easternDate } from "@/lib/time";
import AppHeader from "../../../../AppHeader";
import { Chip, EmailLink, GroupCard, PageTitle, PhoneLink, Stats } from "../../../../ui";
import MembersNav from "../MembersNav";

export default function FamiliesPage() {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Families />
    </Suspense>
  );
}

const money = (n: number) => `$${n.toFixed(n % 1 ? 2 : 0)}`;
const ageOn = (birth: string, today: string) => {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
};

// Members → Families (Directors of Players or Teams): families built from registrations (siblings, and registrations
// sharing a parent's cell or email), each with its parents and guardians (and who has a login), address, children
// (grade, age, team, uniform) and fees. Connected when a guardian has a login with their cell.
async function Families() {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (!hasArea(user, "players", "teams")) redirect("/");
  const families = await listFamilies(user);
  const today = easternDate(new Date());
  const connected = families.filter((f) => f.connected);
  const others = families.filter((f) => !f.connected);
  const owing = families.filter((f) => (f.fees?.remaining ?? 0) > 0).length;

  const card = (f: Family) => (
    <li key={f.key} className="space-y-2 px-4 py-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-semibold">{f.name}</p>
        {f.connected ? <Chip tone="green">Connected</Chip> : <Chip tone="zinc">Not connected</Chip>}
      </div>
      <ul className="space-y-1">
        {f.guardians.map((g) => (
          <li key={g.name + g.cell} className="flex flex-wrap items-center gap-x-2">
            <span className="font-medium">{g.name}</span>
            {g.cell && g.cell.length === 10 && <PhoneLink cell={g.cell} label={formatCell(g.cell)} />}
            {g.email && <EmailLink email={g.email} />}
            {g.login && <Chip tone="green">Login</Chip>}
          </li>
        ))}
      </ul>
      {f.address && <p className="text-zinc-500">{f.address}</p>}
      <div className="flex flex-wrap gap-1">
        {f.children.map((c) => (
          <Chip key={c.name} tone={c.gender === "Boys" ? "blue" : "pink"}>
            {c.name} · {ordinal(c.grade)}
            {c.birthdate && ` · age ${ageOn(c.birthdate, today)}`}
            {c.team && ` · ${c.team}`}
            {(c.uniformSize || c.uniformNumber) &&
              ` · ${[c.uniformSize, c.uniformNumber && `#${c.uniformNumber}`].filter(Boolean).join(" ")}`}
            {c.addedInApp && " · added in app"}
            {c.feesWaivedBy && ` · fees waived by ${c.feesWaivedBy}`}
          </Chip>
        ))}
      </div>
      {f.fees && (
        <p className={f.fees.remaining > 0 ? "font-medium text-amber-700 dark:text-amber-300" : "text-zinc-500"}>
          Fees {money(f.fees.total)} · paid {money(f.fees.paid)}
          {f.fees.remaining > 0 ? ` · ${money(f.fees.remaining)} still owed` : " · paid in full"}
        </p>
      )}
    </li>
  );

  return (
    <>
      <AppHeader user={user} tab="members" context="director" />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">
        <MembersNav user={user} current="families" />
        <PageTitle
          title="Families"
          subtitle="Built from registrations: siblings and shared parents together. Connected families have a login."
        />
        <Stats
          items={[
            { label: "Families", value: families.length },
            { label: "Connected", value: connected.length, tone: "text-emerald-600 dark:text-emerald-400" },
            { label: "Fees owed", value: owing, tone: owing ? "text-amber-600 dark:text-amber-400" : "" },
          ]}
        />
        <div className="space-y-3">
          <GroupCard title="Connected" count={connected.length}>
            {connected.length ? (
              connected.map(card)
            ) : (
              <li className="px-4 py-3 text-sm text-zinc-500 italic">No family has a login yet.</li>
            )}
          </GroupCard>
          <GroupCard title="Not connected yet" count={others.length} defaultOpen={false}>
            {others.map(card)}
          </GroupCard>
        </div>
      </main>
    </>
  );
}
