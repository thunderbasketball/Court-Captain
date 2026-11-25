import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser, devBypass } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features-server";
import { hasFeature } from "@/lib/features";
import { db } from "@/lib/db";
import { SIZES, jerseyName, listUniformOrders, type UniformOrder } from "@/lib/uniforms";
import AppHeader from "../../../AppHeader";
import { GroupCard, PageTitle, genderTint } from "../../../ui";
import { hasArea } from "@/lib/org-admin";
import { pastOrders, vendorView, type VendorRow } from "@/lib/uniform-vendor";
import SubCard from "../../../SubCard";
import HowUniformsWork from "./HowUniformsWork";
import { TZ } from "@/lib/time";
import { CancelOrder, SendToVendor, VendorSettings } from "./VendorPanel";
import { UniformSearch, type UniformHit } from "./UniformSearch";
import OrderSpares, { WaitingSpares } from "./OrderSpares";
import { dupLabel, orgDuplicates } from "@/lib/duplicate-numbers";
import { SPARE_ITEMS, orderCounts, spareCount, spareSummary, type Spare } from "@/lib/spare-items";

import { PageFrame } from "../../../ui";

const missing = <span className="font-medium text-red-600 dark:text-red-400">—</span>;

// Director (view only; coaches set these): uniforms to order. Every rostered player who ordered one, by team: jersey name, number, size.
export async function UniformsContent({
  embedded = false,
}: {
  embedded?: boolean; // inside a Home card: no header or page frame, and never sends you away
} = {}) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  if (embedded) {
    if (!(await hasFeature(db, "thunder", "uniforms"))) return null;
  } else await requireFeature("thunder", "uniforms");
  if (!hasArea(user, "uniforms")) {
    if (embedded) return null;
    redirect("/");
  }

  const [rows, vendor, past, gaps, dups] = await Promise.all([
    listUniformOrders({ pool: db, now: () => new Date() }, user),
    vendorView({ pool: db }, user),
    pastOrders({ pool: db }, user),
    // Why the card is red: any rostered player missing a number (everyone needs one, even with an old uniform), or a size
    // when they ordered (lib/director-alerts.ts), by team.
    db.query<{ id: string; name: string; numbers: number; sizes: number }>(
      `select t.id::text, t.name,
              count(*) filter (where u.number is null)::int as numbers,
              count(*) filter (where (coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null) and u.size is null)::int as sizes
         from team_players p join teams t on t.id = p.team_id
         left join registrations g on g.registrant_id = p.registrant_id
         left join team_uniforms u on u.team_id = p.team_id and u.registrant_id = p.registrant_id
        where u.number is null or ((coalesce(g.uniform_needed, false) or u.needs_uniform_at is not null) and u.size is null)
        group by t.id, t.name, t.grade_sort order by t.grade_sort, lower(t.name)`,
    ),
    orgDuplicates(db, "thunder"), // two players with one number
  ]);
  // The newest order each player went in, as sent (a player changed since then goes in the next order).
  // An order for a team they've left counts on their team now (lib/uniform-order).
  const sentIn = new Map<string, { orderNo: string; number: string | null; size: string | null; team: string | null }>();
  const teamsOf = new Map<string, Set<string>>();
  for (const r of rows) teamsOf.set(r.registrantId, (teamsOf.get(r.registrantId) ?? new Set()).add(r.teamId));
  for (const o of (past ?? []).filter((o) => !o.cancelled))
    for (const p of o.players)
      for (const teamId of teamsOf.get(p.registrantId)?.has(p.teamId) ? [p.teamId] : (teamsOf.get(p.registrantId) ?? []))
        if (!sentIn.has(`${teamId}-${p.registrantId}`))
          sentIn.set(`${teamId}-${p.registrantId}`, { orderNo: o.orderNo, number: p.number, size: p.size, team: teamId === p.teamId ? null : p.team });
  const orderLabel = (r: { teamId: string; registrantId: string; number: string | null; size: string | null }) => {
    const o = sentIn.get(`${r.teamId}-${r.registrantId}`);
    if (!o) return "Not sent yet";
    return o.number === r.number && o.size === r.size ? `Order #${o.orderNo}${o.team ? ` (for ${o.team})` : ""}` : `Changed since order #${o.orderNo} · goes in the next order`;
  };
  const teams = new Map<string, UniformOrder[]>();
  for (const r of rows) teams.set(r.teamId, [...(teams.get(r.teamId) ?? []), r]);
  const bySize = SIZES.map((s) => [s, rows.filter((r) => r.size === s).length] as const).filter(([, n]) => n > 0);
  const noSize = rows.filter((r) => !r.size).length;

  return (
    <>
      {!embedded && <AppHeader user={user} tab="uniforms" context="director" />}
      <PageFrame embedded={embedded} className="mx-auto w-full max-w-md flex-1 px-4 py-6">
        <PageTitle title="Uniforms" subtitle={`${rows.length} ordered by rostered players`} />
        {dups.length > 0 && (
          <div className="mb-4 space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
            <p className="font-semibold">Duplicate numbers (two players on a team):</p>
            <ul className="space-y-0.5">
              {dups.map((d) => (
                <li key={d.id}>
                  <Link href={`/org/thunder/teams/${d.id}?tab=uniforms`} className="font-medium underline">
                    {d.name}
                  </Link>
                  : {dupLabel(d.numbers)}
                </li>
              ))}
            </ul>
          </div>
        )}
        {gaps.rows.length > 0 && (
          <div className="mb-4 space-y-1 rounded-xl bg-red-50 p-3 text-sm text-red-800 ring-1 ring-red-200 dark:bg-red-500/10 dark:text-red-300 dark:ring-red-500/30">
            <p className="font-semibold">Still needed (why this card is red):</p>
            <ul className="space-y-0.5">
              {gaps.rows.map((g) => (
                <li key={g.id}>
                  <Link href={`/org/thunder/teams/${g.id}`} className="font-medium underline">
                    {g.name}
                  </Link>
                  {": "}
                  {[
                    g.numbers ? `${g.numbers} player${g.numbers === 1 ? "" : "s"} with no number` : null,
                    g.sizes ? `${g.sizes} with no size` : null,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                </li>
              ))}
            </ul>
            <p className="text-xs">Every player needs a number, even one who didn&apos;t order a new uniform. Set them on the team&apos;s Uniforms.</p>
          </div>
        )}
        {vendor && (
          <>
            {/* The gear (top right of the card) opens the vendor's email and Cc here; the 🔍 the search. */}
            <VendorSettings email={vendor.email} cc={vendor.cc} setBy={vendor.setBy} />
            <UniformSearch
              hits={[
                ...rows.map(
                  (r): UniformHit => ({
                    key: `c-${r.teamId}-${r.registrantId}`,
                    name: jerseyName(r.lastName),
                    team: r.team,
                    number: r.number,
                    size: r.size,
                    where: `Current · ${orderLabel(r)}`,
                  }),
                ),
                ...(past ?? []).flatMap((o) =>
                  o.players.map(
                    (p): UniformHit => ({
                      key: `o-${o.orderNo}-${p.teamId}-${p.registrantId}`,
                      name: p.name,
                      team: p.team,
                      number: p.number,
                      size: p.size,
                      where: `Order #${o.orderNo}${o.cancelled ? " (cancelled)" : ""}`,
                    }),
                  ),
                ),
              ]}
            />
            <section className="mb-4 space-y-2 rounded-xl p-3 text-sm ring-1 ring-zinc-950/10 dark:ring-white/10">
              <div className="flex items-start justify-between gap-3">
              <p className="min-w-0 font-semibold">
                Uniform vendor{vendor.email ? <span className="font-normal text-zinc-500"> · {vendor.email}</span> : null}
                {vendor.cc.length > 0 && <span className="font-normal text-zinc-500"> · Cc {vendor.cc.length}</span>}
              </p>
              {vendor.email && !user.actingBy && <OrderSpares />}
              </div>
              <p className="text-zinc-600 dark:text-zinc-300">
                {vendor.ready.length} new to send · {vendor.sentPlayers} already sent
                {vendor.held.length > 0 && <span className="text-amber-700 dark:text-amber-400"> · {vendor.held.length} held back</span>}
              </p>
              {vendor.held.length > 0 && (
                <ul className="space-y-0.5 text-xs text-amber-700 dark:text-amber-400">
                  {vendor.held.map((h) => (
                    <li key={`${h.teamId}-${h.registrantId}`}>
                      {h.team} · {h.name}: {h.missing}
                    </li>
                  ))}
                </ul>
              )}
              {vendor.last && (
                <p className="text-xs text-zinc-500">
                  Last order #{vendor.last.orderNo}: {vendor.last.counts}
                  {vendor.last.everyone ? " (everyone)" : ""} to {vendor.last.to}, sent by {vendor.last.sentBy} on{" "}
                  {vendor.last.sentAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ })}
                </p>
              )}
              <WaitingSpares spares={vendor.spares} canEdit={!user.actingBy} />
              <SendToVendor ready={vendor.ready.length} spares={spareCount(vendor.spares)} hasVendor={!!vendor.email} />
            </section>
            <div className="mb-4">
              <HowUniformsWork />
            </div>
            {past && past.length > 0 && (
              <div className="mb-4">
                <SubCard title="Past orders" count={past.length}>
                  <div className="space-y-2">
                    {past.map((o) => (
                      <SubCard
                        key={o.orderNo}
                        title={`#${o.orderNo}`}
                        count={`${orderCounts(o.players.length, spareCount(o.spares))}${o.cancelled ? " · Cancelled" : ""}`}
                      >
                        <p className="mb-2 text-xs text-zinc-500">
                          Sent by {o.sentBy} on{" "}
                          {o.sentAt.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ })} to {o.to}
                          {o.cc.length ? `, Cc ${o.cc.join(", ")}` : ""}
                          {o.everyone ? " · everyone" : ""}
                        </p>
                        {o.cancelled && (
                          <p className="mb-2 text-xs font-medium text-red-600 dark:text-red-400">
                            Cancelled by {o.cancelled.by} on{" "}
                            {o.cancelled.at.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: TZ })}
                          </p>
                        )}
                        {o.canCancel && (
                          <div className="mb-3">
                            <CancelOrder orderNo={o.orderNo} to={o.to} />
                          </div>
                        )}
                        {o.players.length > 0 && <OrderRows players={o.players} />}
                        {o.spares.length > 0 && <SpareRows rows={o.spares} />}
                      </SubCard>
                    ))}
                  </div>
                </SubCard>
              </div>
            )}
          </>
        )}
        {rows.length > 0 && (
          <p className="mb-4 flex flex-wrap gap-x-3 gap-y-1 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
            {bySize.map(([s, n]) => (
              <span key={s}>
                <span className="font-semibold">{s}</span> {n}
              </span>
            ))}
            {noSize > 0 && <span className="font-medium text-red-600 dark:text-red-400">No size yet {noSize}</span>}
            {rows.some((r) => r.late) && (
              <span className="text-zinc-500">
                <span className="text-amber-600 dark:text-amber-400">✱</span> added after registration{" "}
                {rows.filter((r) => r.late).length}
              </span>
            )}
          </p>
        )}
        {!rows.length && <p className="text-sm text-zinc-500">No rostered player has ordered a uniform yet.</p>}
        <div className="space-y-3">
          {[...teams].map(([teamId, list]) => (
            <GroupCard key={teamId} title={list[0].team} count={list.length}>
              {list.map((r) => (
                <li key={r.registrantId} className="grid grid-cols-[1fr_3rem_3rem] items-center gap-2 px-4 py-2 text-sm">
                  <span className="min-w-0 truncate font-semibold tracking-wide">
                    {jerseyName(r.lastName)}
                    {r.late && (
                      <span title="Added after registration" className="ml-1 font-normal text-amber-600 dark:text-amber-400">
                        ✱
                      </span>
                    )}
                    {vendor && (
                      <span className="block text-xs font-normal tracking-normal text-zinc-500">
                        {orderLabel(r)}
                      </span>
                    )}
                  </span>
                  <span className="text-right tabular-nums">{r.number ? `#${r.number}` : missing}</span>
                  <span className="text-right">{r.size ?? missing}</span>
                </li>
              ))}
            </GroupCard>
          ))}
        </div>
      </PageFrame>
    </>
  );
}

// A spares order as sent: each kind, with its numbers and sizes.
function SpareRows({ rows }: { rows: Spare[] }) {
  return (
    <div className="space-y-3 text-sm">
      {SPARE_ITEMS.filter((i) => rows.some((r) => r.item === i.key)).map((i) => (
        <div key={i.key}>
          <p className="mt-3 mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">Spare {i.many}</p>
          <ul className="grid gap-x-6 rounded-lg p-2 ring-1 ring-zinc-950/10 sm:grid-cols-3 dark:ring-white/10">
            {rows
              .filter((r) => r.item === i.key)
              .map((r, n) => (
                <li key={n} className="flex justify-between gap-3 py-0.5 tabular-nums">
                  <span className="font-medium">{r.item === "shorts" ? r.size : `#${r.number}`}</span>
                  <span>{r.item === "shorts" ? `× ${r.qty}` : r.size}</span>
                </li>
              ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

// One past order's players as sent: GIRLS then BOYS, each team's players by jersey number.
function OrderRows({ players }: { players: VendorRow[] }) {
  return (
    <div className="space-y-3 text-sm">
      {["Girls", "Boys"].map((g) => {
        const list = players.filter((p) => p.gender === g);
        if (!list.length) return null;
        return (
          <div key={g}>
            <p className="mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase">{g}</p>
            <ul className={`divide-y divide-zinc-100 rounded-lg ring-1 dark:divide-white/5 ${genderTint(g) ?? ""}`}>
              {list.map((p) => (
                <li key={`${p.teamId}-${p.registrantId}`} className="grid grid-cols-[6rem_1fr_3rem_3rem] items-center gap-2 px-3 py-1.5">
                  <span className="truncate text-zinc-500">{p.team}</span>
                  <span className="truncate font-semibold tracking-wide">{p.name}</span>
                  <span className="text-right tabular-nums">#{p.number}</span>
                  <span className="text-right">{p.size}</span>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
