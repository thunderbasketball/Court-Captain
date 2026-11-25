"use client";

import { useEffect } from "react";
import { versionsOf } from "@/lib/whats-new";
import type { MyRelease } from "@/lib/whats-new-seen";
import SubCard from "../SubCard";
import { sawWhatsNew } from "./actions";

const date = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

// Every version with something for this person, newest first, its revisions (major or minor) each a card that opens: what's new, what it's for and how to
// use it. `seen`: looking at it (here) ends its highlight.
export default function WhatsNew({ releases, fresh = [], seen = false }: { releases: MyRelease[]; fresh?: string[]; seen?: boolean }) {
  useEffect(() => {
    if (seen) void sawWhatsNew().catch(() => {}); // not worth an error: it stays highlighted until next time
  }, [seen]);
  if (!releases.length) return <p className="text-sm text-zinc-500">Nothing new yet.</p>;
  return (
    <div className="space-y-2">
      {versionsOf(releases).map(([v, list], n) => (
        <SubCard key={v} title={`Version ${v}`} count={`${list.length} revision${list.length === 1 ? "" : "s"}`} open={n === 0}>
          <div className="space-y-2">
      {list.map((r, i) => (
        <SubCard key={r.version} title={`${r.version} ${r.title}`} count={`${r.kind === "major" ? "Major" : "Minor"} · ${date(r.date)}`} warn={fresh.includes(r.version)} open={n === 0 && i === 0}>
          <ul className="grid items-start gap-3 lg:grid-cols-2">
            {r.items.map((x) => (
              <li key={x.key} className="rounded-xl bg-white p-3 text-sm ring-1 ring-zinc-950/10 dark:bg-zinc-900 dark:ring-white/10">
                <p className="font-semibold">{x.title}</p>
                <p className="mt-0.5 text-zinc-600 dark:text-zinc-300">{x.purpose}</p>
                <p className="mt-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">How to use it</p>
                <ol className="mt-0.5 list-decimal space-y-0.5 pl-5 text-zinc-600 dark:text-zinc-300">
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
