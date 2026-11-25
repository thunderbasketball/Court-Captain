import { AUDIENCE_LABEL, NEEDS } from "@/lib/support-library";
import { RELEASES, versionsOf } from "@/lib/whats-new";
import SubCard from "../SubCard";

const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// CourtCaptain staff: every version, all of what's in it and who each part is for.
export default function Versions() {
  return (
    <div className="space-y-2">
      {versionsOf(RELEASES).map(([v, list], n) => (
        <SubCard key={v} title={`Version ${v}`} count={`${list.length} revisions`} open={n === 0}>
          <div className="space-y-2">
      {list.map((r, i) => (
        <SubCard key={r.version} title={`${r.version} ${r.title}`} count={`${r.kind === "major" ? "Major" : "Minor"} · ${date(r.date)} · ${r.items.length} changes`} open={i === 0}>
          <ul className="grid items-start gap-3 lg:grid-cols-2">
            {r.items.map((x) => (
              <li key={x.key} className="rounded-xl p-3 text-sm ring-1 ring-zinc-950/10 dark:ring-white/10">
                <p className="font-semibold">{x.title}</p>
                <p className="text-xs text-zinc-500">
                  {x.who.map((w) => AUDIENCE_LABEL[w]).join(", ")}
                  {x.needs && ` · needs ${x.needs.map((n) => NEEDS[n]).join(" + ")}`}
                </p>
                <p className="mt-1 text-zinc-600 dark:text-zinc-300">{x.purpose}</p>
                <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-300">
                  {x.how.map((h, n) => (
                    <li key={n}>{h}</li>
                  ))}
                </ol>
              </li>
            ))}
          </ul>
        </SubCard>
      ))}
          </div>
        </SubCard>
      ))}
    </div>
  );
}
