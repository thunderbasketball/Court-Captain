"use client";

import { useState } from "react";
import { ProgramEditor } from "../org/scenic-city/programs/ProgramTools";
import PlayerProgramForm from "./PlayerProgramForm";

// The Programs card's +: pick what kind of program (only the kinds the organization's features allow), then its form,
// right in the card.
export default function NewProgramPanel({
  org,
  players,
  teams,
  sources,
}: {
  org: string;
  players: boolean; // CourtPlayers: a Season players register for
  teams: boolean; // CourtTeams: a League, Circuit or Tournament teams register for
  sources: { id: string; name: string; startsOn: string; endsOn: string }[];
}) {
  const [n, setN] = useState(0); // a fresh form after each save
  const [kind, setKind] = useState<"players" | "teams" | null>(players && !teams ? "players" : !players && teams ? "teams" : null);
  const pill = (on: boolean) =>
    `rounded-full px-3 py-1.5 text-sm font-medium ${on ? "bg-thunder-blue text-white" : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"}`;
  return (
    <div className="space-y-3">
      {players && teams && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={pill(kind === "players")} onClick={() => setKind("players")}>
            Season · players register
          </button>
          <button type="button" className={pill(kind === "teams")} onClick={() => setKind("teams")}>
            League, Circuit or Tournament · teams register
          </button>
        </div>
      )}
      {kind === "players" && <PlayerProgramForm org={org} sources={sources} />}
      {kind === "teams" && <ProgramEditor key={n} inline={() => setN(n + 1)} />}
    </div>
  );
}
