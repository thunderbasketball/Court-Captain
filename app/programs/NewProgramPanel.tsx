"use client";

import ProgramForm from "./ProgramForm";

// The Programs card's +: the program form right in the card: General (name, type, options) first, then the type's own
// card. Only the types the organization's features allow (CourtPlayers, CourtEvents).
export default function NewProgramPanel({
  org,
  players,
  teams,
  sources,
  facilities = [],
}: {
  facilities?: string[]; // the organization's gyms (a tryout's Place)
  org: string;
  players: boolean; // CourtPlayers: Season, Training Session, Training Course
  teams: boolean; // CourtEvents: League, Tournament, Shootout, Circuit
  sources: { id: string; name: string; startsOn: string; endsOn: string }[];
}) {
  return <ProgramForm org={org} players={players} teams={teams} sources={sources} facilities={facilities} />;
}
