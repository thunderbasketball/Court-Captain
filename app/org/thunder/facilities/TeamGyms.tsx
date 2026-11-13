"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { gradesText } from "@/lib/event-names";
import { GroupCard } from "../../../ui";
import { setTeamGymAction } from "./actions";

export type TeamGymsTeam = {
  id: string;
  name: string;
  level: string;
  gender: "Boys" | "Girls";
  grades: string[];
  gyms: string[];
  everyGym: boolean;
  setBy: string | null;
};

const group = <T, K extends string>(list: T[], key: (x: T) => K) => {
  const out = new Map<K, T[]>();
  for (const x of list) out.set(key(x), [...(out.get(key(x)) ?? []), x]);
  return [...out.entries()];
};

// Team Practice Facilities: every team by Level, Gender and Grade, each with a checkbox for each gym. Checked = the
// team's coaches see and book practices there. Saves at once (in the background), and puts it back if it's refused.
export default function TeamGyms({ gyms, teams, who }: { gyms: string[]; teams: TeamGymsTeam[]; who: boolean }) {
  const router = useRouter();
  const [rows, setRows] = useState(teams);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState<{ team: string; text: string } | null>(null);
  // Fresh data from the server replaces the local copy once nothing is still saving.
  const [seen, setSeen] = useState(teams);
  if (teams !== seen && !saving) {
    setSeen(teams);
    setRows(teams);
  }

  const toggle = (t: TeamGymsTeam, gym: string, on: boolean) => {
    setError(null);
    const before = rows;
    setRows((rs) =>
      rs.map((r) => (r.id === t.id ? { ...r, everyGym: false, gyms: gyms.filter((g) => (g === gym ? on : r.gyms.includes(g))) } : r)),
    );
    setSaving((n) => n + 1);
    setTeamGymAction({ teamId: t.id, gym, on })
      .then((r) => {
        if (!r.ok) {
          setRows(before);
          setError({ team: t.id, text: r.message });
        }
      })
      .catch(() => {
        setRows(before);
        setError({ team: t.id, text: "Couldn't save. Check your connection and try again." });
      })
      .finally(() => {
        setSaving((n) => n - 1);
        router.refresh();
      });
  };

  if (!gyms.length) return <p className="text-sm text-zinc-500">Add a gym first.</p>;
  if (!rows.length) return <p className="text-sm text-zinc-500">No teams yet.</p>;
  return (
    <div className="space-y-2">
      <p className="text-sm text-zinc-500">
        Check where each team may book practices. Its coaches see and book only the checked gyms. Uncheck them all for a team that practices at its own gym (Own gym is always there).
      </p>
      {group(rows, (t) => (t.level === "COMP" ? "COMP" : "REC")).map(([level, inLevel]) => (
        <GroupCard key={level} title={level} count={inLevel.length} defaultOpen={false}>
          <div className="space-y-2 p-2">
            {group(inLevel, (t) => t.gender).map(([gender, inGender]) => (
              <GroupCard key={gender} title={gender} count={inGender.length} gender={gender} defaultOpen={false}>
                <div className="divide-y divide-zinc-100 dark:divide-white/5">
                  {group(inGender, (t) => gradesText(t.grades) || "No grade").map(([grade, inGrade]) => (
                    <div key={grade} className="px-4 py-2">
                      <p className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{grade}</p>
                      {inGrade.map((t) => (
                        <div key={t.id} className="py-1.5">
                          <p className="text-sm font-semibold">
                            {t.name}
                            {t.everyGym && <span className="font-normal text-zinc-500"> · every gym</span>}
                            {!t.everyGym && !t.gyms.length && <span className="font-normal text-amber-700 dark:text-amber-400"> · Own gym only</span>}
                            {who && t.setBy && <span className="text-xs font-normal text-zinc-400"> · set by {t.setBy}</span>}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-2">
                            {gyms.map((g) => {
                              const on = t.gyms.includes(g);
                              return (
                                <label
                                  key={g}
                                  className={`flex cursor-pointer items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
                                    on
                                      ? "bg-blue-50 text-thunder-blue ring-thunder-blue/40 dark:bg-blue-500/10 dark:text-blue-300"
                                      : "text-zinc-500 ring-zinc-200 dark:ring-white/10"
                                  }`}
                                >
                                  <input type="checkbox" className="size-4" checked={on} onChange={(e) => toggle(t, g, e.target.checked)} />
                                  {g}
                                </label>
                              );
                            })}
                          </div>
                          {error?.team === t.id && <p className="mt-1 text-xs text-red-600">{error.text}</p>}
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </GroupCard>
            ))}
          </div>
        </GroupCard>
      ))}
    </div>
  );
}
