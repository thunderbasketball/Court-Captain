import { db } from "@/lib/db";
import type { SessionUser } from "@/lib/auth/service";
import { hostDocuments } from "@/lib/host-documents";
import type { OrgSlug } from "@/lib/orgs";

const dayLabel = (d: string) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" });
const link = "font-medium text-thunder-blue hover:underline dark:text-blue-400";
const head = "mb-1 text-xs font-semibold tracking-wide text-zinc-500 uppercase";

// Documents (a hosting organization's Home card): each League's Rules (added by the League), a Blank Scoresheet, and
// each coming Game Day's scoresheets for the games placed at its gyms. Each opens in a new tab to read or print.
export default async function DocumentsCard({ org, user }: { org: OrgSlug; user: SessionUser }) {
  const docs = await hostDocuments({ pool: db, now: () => new Date() }, user, org);
  if (!docs) return null;
  return (
    <div className="space-y-4 text-sm">
      <section>
        <p className={head}>Rules</p>
        {!docs.leagues.length ? (
          <p className="text-zinc-500">No Leagues this season yet.</p>
        ) : (
          <ul className="space-y-1">
            {docs.leagues.map((l) => (
              <li key={l.id}>
                {l.rules ? (
                  <a href={`/program-rules/${l.id}`} target="_blank" rel="noopener" className={link}>
                    📄 {l.name} rules
                  </a>
                ) : (
                  <span className="text-zinc-500">
                    📄 {l.name} rules <span className="text-xs">· to be added by the League</span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <p className={head}>Scoresheets</p>
        <ul className="space-y-1">
          <li>
            <a href="/print/scoresheets?blank=1" target="_blank" rel="noopener" className={link}>
              🖨 Blank scoresheet
            </a>
          </li>
          {docs.days.map((d) =>
            d.gyms.map((g) => (
              <li key={`${d.day}-${g.key}`}>
                <a href={`/print/scoresheets?day=${d.day}&gym=${encodeURIComponent(g.key)}`} target="_blank" rel="noopener" className={link}>
                  🖨 {dayLabel(d.day)} scoresheets
                </a>{" "}
                <span className="text-zinc-500">
                  · {g.name} · {g.games} game{g.games === 1 ? "" : "s"}
                </span>
              </li>
            )),
          )}
        </ul>
        {!docs.days.length && <p className="mt-1 text-xs text-zinc-500">Game Day scoresheets show here once games are scheduled at your gyms.</p>}
      </section>
    </div>
  );
}
