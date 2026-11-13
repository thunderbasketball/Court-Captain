import { redirect } from "next/navigation";
import { Suspense } from "react";
import { currentUser, devBypass } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { gymScoresheets, type Scoresheet, type SheetTeam } from "@/lib/scoresheets";
import PrintButton from "./PrintButton";

export default function Page({ searchParams }: PageProps<"/print/scoresheets">) {
  return (
    <Suspense fallback={<p className="p-4 text-zinc-500">Loading…</p>}>
      <Sheets searchParams={searchParams} />
    </Suspense>
  );
}

const PRINT_CSS = `
        @page { size: letter; margin: 0.35in; }
        .scoresheets { color-scheme: light; }
        .sheet { break-after: page; }
        .sheet:last-child { break-after: auto; }
        .sheet table { border-collapse: collapse; width: 100%; }
        .sheet th, .sheet td { border: 1px solid #000; }
        @media print { .scoresheets * { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
      `;
const BLANK: Scoresheet = { id: "blank", league: "", division: "", date: "", starts: "", minutes: 0, gym: "", court: "", address: null, home: null, away: null, officials: [] };
// A line to write on, where a blank scoresheet has nothing.
const Line = ({ w = "w-28" }: { w?: string }) => <span className={`inline-block ${w} border-b border-black align-bottom`}>&nbsp;</span>;

const clock = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
};
const longDate = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric", year: "numeric" });

// Scoresheets for one gym on one Game Day (from the Scheduler's Grid, 🖨 on a gym): a Letter page per game, ready to
// print or save as a PDF. Always black on white, whatever the screen's theme.
async function Sheets({ searchParams }: { searchParams: PageProps<"/print/scoresheets">["searchParams"] }) {
  const user = await currentUser();
  if (!user) redirect(devBypass ? "/dev-login" : "/login");
  const sp = await searchParams;
  // A blank scoresheet (Documents card): everything to write in.
  if (sp.blank === "1")
    return (
      <div className="scoresheets bg-zinc-100 text-black print:bg-white">
        <style>{PRINT_CSS}</style>
        <div className="mx-auto flex max-w-[8.5in] items-center justify-between gap-3 px-4 py-4 print:hidden">
          <p className="font-semibold">Blank scoresheet</p>
          <PrintButton count={1} />
        </div>
        <Sheet s={BLANK} n={null} />
      </div>
    );
  const data = await gymScoresheets({ pool: db }, user, sp.day, sp.gym);
  if (!data)
    return <p className="p-6 text-sm">Scoresheets are for the Scheduler, and for the gym&apos;s own Admins and Directors of Facilities.</p>;
  return (
    <div className="scoresheets bg-zinc-100 text-black print:bg-white">
      <style>{PRINT_CSS}</style>
      <div className="mx-auto flex max-w-[8.5in] flex-wrap items-center justify-between gap-3 px-4 py-4 print:hidden">
        <div>
          <p className="font-semibold">
            {data.gym} · {longDate(data.date)}
          </p>
          <p className="text-sm text-zinc-600">
            {data.host} · {data.sheets.length} game{data.sheets.length === 1 ? "" : "s"}, one page each
          </p>
        </div>
        {data.sheets.length > 0 && <PrintButton count={data.sheets.length} />}
      </div>
      {!data.sheets.length && <p className="px-4 pb-6 text-sm print:hidden">No games are placed at this gym that day yet.</p>}
      {data.sheets.map((s, i) => (
        <Sheet key={s.id} s={s} n={i + 1} />
      ))}
    </div>
  );
}

function Sheet({ s, n }: { s: Scoresheet; n: number | null }) {
  const blank = n === null;
  return (
    <section className="sheet mx-auto mb-6 w-full max-w-[8.5in] bg-white p-5 text-[11px] leading-tight shadow print:mb-0 print:max-w-none print:p-0 print:shadow-none">
      <header className="mb-2 flex items-start justify-between gap-4 border-b-2 border-black pb-1.5">
        <div>
          <p className="text-lg font-bold">Official Scoresheet</p>
          <p className="text-[12px]">
            {blank ? (
              <>
                League <Line w="w-40" /> Division <Line w="w-28" />
              </>
            ) : (
              `${s.league} · ${s.division}`
            )}
          </p>
        </div>
        <div className="text-right text-[12px]">
          <p className="font-semibold">
            {blank ? (
              <>
                Date <Line w="w-28" /> Time <Line w="w-16" />
              </>
            ) : (
              `${longDate(s.date)} · ${clock(s.starts)}`
            )}
          </p>
          <p className={blank ? "mt-1.5" : ""}>
            {blank ? (
              <>
                Gym <Line w="w-32" /> Court <Line w="w-14" />
              </>
            ) : (
              `${s.gym} · ${s.court} · Game ${n}`
            )}
          </p>
          {s.address && <p className="text-[10px]">{s.address}</p>}
        </div>
      </header>
      <ScoreByPeriod home={s.home?.name ?? "Home"} away={s.away?.name ?? "Away"} />
      <TeamBlock side="Home" team={s.home} blank={blank} />
      <TeamBlock side="Away" team={s.away} blank={blank} />
      {/* The game's assigned referees printed on their lines (when it has them), then the table crew. */}
      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-3">
        {[
          ["Referee", s.officials[0] ?? null],
          ["Referee", s.officials[1] ?? null],
          ["Scorekeeper", null],
          ["Timekeeper", null],
        ].map(([r, name], i) => (
          <p key={i} className="flex items-end gap-2">
            <span className="shrink-0">{r}:</span>
            {name && <span className="shrink-0 font-semibold">{name}</span>}
            <span className="flex-1 border-b border-black" />
          </p>
        ))}
      </div>
    </section>
  );
}

// At the top: the score by period, with the winner and final score beside it.
function ScoreByPeriod({ home, away }: { home: string; away: string }) {
  return (
    <div className="mb-2 grid grid-cols-[1fr_11rem] gap-3">
      <table>
        <thead>
          <tr className="bg-zinc-100">
            <th className="px-1 py-0.5 text-left">Score by period</th>
            {["1", "2", "3", "4", "OT", "Final"].map((p) => (
              <th key={p} className="w-20 py-0.5">
                {p}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[home, away].map((t, i) => (
            <tr key={i} className="h-5">
              <td className="px-1">{t}</td>
              {[0, 1, 2, 3, 4, 5].map((c) => (
                <td key={c} />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="space-y-2.5 pt-1">
        <p className="flex items-end gap-2">
          Winner: <span className="flex-1 border-b border-black" />
        </p>
        <p>
          Final score: <span className="inline-block w-12 border-b border-black" /> to <span className="inline-block w-12 border-b border-black" />
        </p>
      </div>
    </div>
  );
}

const ROWS = 15; // roster lines per team
function TeamBlock({ side, team, blank = false }: { side: "Home" | "Away"; team: SheetTeam | null; blank?: boolean }) {
  const players = team?.players ?? [];
  const rows = ROWS;
  return (
    <div className="mb-2">
      <p className="mb-0.5 text-[13px] font-bold">
        {side}: {team?.name ?? (blank ? <Line w="w-56" /> : "TBD")}
      </p>
      <RunningScore />
      <table>
        <thead>
          <tr className="bg-zinc-100">
            <th className="w-8 py-0.5">#</th>
            <th className="px-1 py-0.5 text-left">Player</th>
            <th className="w-[86px] py-0.5" colSpan={5}>
              Fouls
            </th>
            {["1", "2", "3", "4", "OT"].map((q) => (
              <th key={q} className="w-[72px] py-0.5">
                {q}
              </th>
            ))}
            <th className="w-11 py-0.5">Pts</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, i) => {
            const p = players[i];
            return (
              <tr key={i} className="h-[16px]">
                <td className="text-center font-semibold">{p?.jersey ?? ""}</td>
                <td className="px-1">{p?.name ?? ""}</td>
                {[1, 2, 3, 4, 5].map((f) => (
                  <td key={f} className="w-[17px] text-center text-[8px] text-zinc-400">
                    {f}
                  </td>
                ))}
                {[0, 1, 2, 3, 4, 5].map((c) => (
                  <td key={c} />
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1">
        <Boxes label="Timeouts" n={2} />
        <span className="font-semibold">Team fouls:</span>
        {/* 5 per period. */}
        {[1, 2, 3, 4].map((p) => (
          <Boxes key={p} label={`P${p}`} n={5} />
        ))}
      </div>
    </div>
  );
}

function Boxes({ label, n }: { label: string; n: number }) {
  return (
    <span className="flex items-center gap-1">
      <span>{label}</span>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className="inline-flex size-3.5 items-center justify-center border border-black text-[7px] text-zinc-400">
          {i + 1}
        </span>
      ))}
    </span>
  );
}

// Running score (above each team's roster): cross off each point as it's scored (write the player's number beside it), 1–100.
function RunningScore() {
  return (
    <div className="mb-1 flex items-stretch gap-1">
      <span className="w-14 shrink-0 pt-0.5 text-[10px] font-semibold">Running score</span>
      <div className="grid flex-1 grid-cols-[repeat(25,minmax(0,1fr))] border-t border-l border-black">
        {Array.from({ length: 100 }, (_, i) => (
          <span key={i} className="h-3.5 border-r border-b border-black text-center text-[7px] leading-[14px] text-zinc-500">
            {i + 1}
          </span>
        ))}
      </div>
    </div>
  );
}
