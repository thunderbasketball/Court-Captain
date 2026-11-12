import { familiesOf, type Family } from "@/lib/families";
import { ordinal } from "@/lib/grades";
import { hasArea, seesWho } from "@/lib/org-admin";
import { db } from "@/lib/db";
import { formatCell } from "@/lib/phone";
import { easternDate } from "@/lib/time";
import { Chip, EmailLink, GroupCard, PageTitle, PhoneLink } from "../../../../ui";

import type { SessionUser } from "@/lib/auth/service";

const money = (n: number) => `$${n.toFixed(n % 1 ? 2 : 0)}`;
const ageOn = (birth: string, today: string) => {
  const [by, bm, bd] = birth.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  return ty - by - (tm < bm || (tm === bm && td < bd) ? 1 : 0);
};

// Members → Families (Directors of Players or Teams): families built from registrations (siblings, and registrations
// sharing a parent's cell or email), each with its parents and guardians (and who has a login), address, children
// (grade, age, team, uniform) and fees. Connected when a guardian has a login with their cell.
export default async function FamiliesPart({ user }: { user: SessionUser }) {
  if (!hasArea(user, "players", "teams")) return null;
  const who = await seesWho(db, user, "thunder"); // Owners and Admins see who did it
  const families = await familiesOf(user); // shared with the card's (n) on the same page
  const today = easternDate(new Date());
  const connected = families.filter((f) => f.connected);
  const others = families.filter((f) => !f.connected);

  // Paid in full: green; still owed: yellow.
  const feeChip = (f: Family) =>
    f.fees &&
    (f.fees.remaining > 0 ? (
      <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-300 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-400/30">
        {money(f.fees.remaining)} owed
      </span>
    ) : (
      <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-300 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-400/30">
        Paid {money(f.fees.paid)}
      </span>
    ));

  // Each family one line (name and its fees), opened to its guardians, address, children and fees.
  const card = (f: Family) => (
    <li key={f.key}>
      <details className="group/f">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm select-none [&::-webkit-details-marker]:hidden">
          <span className="min-w-0 flex-1 truncate font-semibold">{f.name}</span>
          {feeChip(f)}
          <span aria-hidden className="text-zinc-400 transition-transform [details[open]>summary_&]:rotate-90">
            ›
          </span>
        </summary>
        <div className="space-y-2 px-4 pb-3 text-sm">
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
                {c.feesWaivedBy && ` · fees waived${who ? ` by ${c.feesWaivedBy}` : ""}`}
              </Chip>
            ))}
          </div>
          {f.fees && (
            <p
              className={`inline-block rounded-lg px-2 py-1 font-medium ${
                f.fees.remaining > 0
                  ? "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200"
                  : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
              }`}
            >
              Fees {money(f.fees.total)} · paid {money(f.fees.paid)}
              {f.fees.remaining > 0 ? ` · ${money(f.fees.remaining)} still owed` : " · paid in full"}
            </p>
          )}
        </div>
      </details>
    </li>
  );

  return (
    <>
        <PageTitle
          title="Families"
          subtitle="Built from registrations: siblings and shared parents together. Connected families have a login."
        />
        <div className="space-y-3">
          <GroupCard title="Connected" count={connected.length} defaultOpen={false}>
            {connected.length ? (
              connected.map(card)
            ) : (
              <li className="px-4 py-3 text-sm text-zinc-500 italic">No family has a login yet.</li>
            )}
          </GroupCard>
          <GroupCard title="Not connected" count={others.length} defaultOpen={false}>
            {others.map(card)}
          </GroupCard>
        </div>
    </>
  );
}
