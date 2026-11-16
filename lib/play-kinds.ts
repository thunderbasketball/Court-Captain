// CourtPlaybook's play types (browser-safe; rules in lib/playbook.ts).
export const PLAY_KINDS = ["Offense", "Defense", "Inbounds", "Drill"] as const;
export type PlayKind = (typeof PLAY_KINDS)[number];
export const playKindLabel = (k: PlayKind) => (k === "Drill" ? "Drills" : k);
// The id of a team's Playbook add form (its round + and the panel it opens).
export const playbookPanel = (teamId: string) => `playbook-${teamId}`;
