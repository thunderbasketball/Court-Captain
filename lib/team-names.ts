// Team naming rules, shared by the server and the New team form.
export const GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"] as const;
export const LEVELS = ["REC", "COMP"] as const;
// Scenic City Leagues also have Pre-K (ages 3 and 4; grade -1): organizations' teams can be Pre-K, always Coed and REC.
export const PREK = "PK";
export type Gender = "Boys" | "Girls" | "Coed";
export const gradeSort = (g: string) => (g === PREK ? -1 : g === "K" ? 0 : Number(g));
export const gradeNum = gradeSort;
export const gradeStr = (n: number) => (n === -1 ? PREK : n === 0 ? "K" : String(n));

// "4G Epps", "KB Harper", "PKC Lee" (Pre-K Coed); a multi-grade team takes its top grade.
export function teamName(gender: Gender, grades: string[], headLastName: string): string {
  const top = [...grades].sort((a, b) => gradeSort(b) - gradeSort(a))[0];
  return `${top}${gender[0]} ${headLastName.trim()}`;
}

// One grade, or two next to each other (3rd/4th): what leagues place by. Grades as in GRADES ("K", "1" … "12"), and
// Pre-K ("PK", on its own) where `preK` allows it.
export function gradesOk(grades: string[], preK = false): boolean {
  if (preK && grades.length === 1 && grades[0] === PREK) return true;
  if (!grades.length || grades.length > 2 || !grades.every((g) => (GRADES as readonly string[]).includes(g))) return false;
  if (grades.length === 1) return true;
  const [a, b] = grades.map(gradeSort).sort((x, y) => x - y);
  return b === a + 1;
}

// ---- Names in use: the same name is numbered, every one of them ----
// "3G Campbell" for one team; when another would get it too, both are numbered: "3G Campbell 1" and "3G Campbell 2"
// (a 3rd is "3G Campbell 3"). Teams with no Head Coach yet the same way: "4G TBD", then "4G TBD 1" and "4G TBD 2".

export type NamedTeam = { id: string; name: string };
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// "3G Campbell 2" → "3G Campbell".
export const baseName = (name: string) => name.replace(/ \d{1,3}$/, "");
const inGroup = (name: string, base: string) => new RegExp(`^${escape(base)}( \\d{1,3})?$`, "i").test(name);

// The name a new team gets (`base` by the rule), and the teams to rename first (one that had `base` gets a number).
export function placeName(teams: NamedTeam[], base: string): { name: string; renames: NamedTeam[] } {
  const group = teams.filter((t) => inGroup(t.name, base));
  if (!group.length) return { name: base, renames: [] };
  const used = new Set(group.map((t) => Number(t.name.slice(base.length).trim()) || 0));
  const next = () => {
    let n = 1;
    while (used.has(n)) n++;
    used.add(n);
    return `${base} ${n}`;
  };
  const renames = group.filter((t) => t.name.toLowerCase() === base.toLowerCase()).map((t) => ({ id: t.id, name: next() }));
  return { name: next(), renames };
}

// After a team leaves a name (renamed or deleted): the one team left with it drops its number ("3G Campbell 1" →
// "3G Campbell"). `teams`: those still there.
export function settleName(teams: NamedTeam[], base: string): NamedTeam | null {
  const group = teams.filter((t) => inGroup(t.name, base));
  return group.length === 1 && group[0].name !== base ? { id: group[0].id, name: base } : null;
}

// An import's preview: the name each new row will get, numbered against the teams already there and the rows before it.
// `add` returns notes for teams already there that get a number because of it.
export function namePlanner(existing: NamedTeam[]) {
  const teams = existing.map((t) => ({ ...t }));
  const already = new Set(existing.map((t) => t.id));
  return {
    add(key: string, base: string): string[] {
      const { name, renames } = placeName(teams, base);
      const notes: string[] = [];
      for (const r of renames) {
        const t = teams.find((x) => x.id === r.id)!;
        if (already.has(r.id)) notes.push(`${t.name} (already a team) becomes ${r.name}`);
        t.name = r.name;
      }
      teams.push({ id: key, name });
      return notes;
    },
    nameOf: (key: string) => teams.find((t) => t.id === key)?.name ?? "",
  };
}

// An import's rows already there: a row with a coach is the team with that name (numbered or not) and level, each team
// matched once (so a coach's COMP and REC teams are each found).
export function existingTeams(teams: { name: string; level: string }[]) {
  const used = new Set<number>();
  return (base: string, level: string | null) => {
    const i = teams.findIndex((t, k) => !used.has(k) && t.level === level && inGroup(t.name, base));
    if (i < 0) return false;
    used.add(i);
    return true;
  };
}

// With no Head Coach yet: "4G TBD" (numbered when there's another).
export const tbdBase = (gender: Gender, grades: string[]) => teamName(gender, grades, "TBD");

// Pre-K teams are Coed and REC, and Coed teams are Pre-K. The problem to show, or null.
export function preKProblem(gender: Gender, grades: string[], level: string): string | null {
  const preK = grades.includes(PREK);
  if (preK && gender !== "Coed") return "Pre-K teams are Coed.";
  if (!preK && gender === "Coed") return "Only Pre-K teams are Coed; pick Boys or Girls.";
  if (preK && level !== "REC") return "Pre-K teams are REC.";
  return null;
}
export const isGender = (v: unknown): v is Gender => v === "Boys" || v === "Girls" || v === "Coed";

// A team's name in a league: its organization's Abbreviation first ("ER 5B Harris").
export const leagueName = (abbr: string, name: string) => `${abbr} ${name}`;
