// Lists for the Coaches card's 📣 (Members): coaches by Gender → Grade → Team → Coach, and Thunder's registration
// volunteers by Gender → Grade → Role → Volunteer, for PeoplePicker. Plain functions (no server code).
import type { CoachGroup } from "@/lib/coaches";
import { gradeLabel } from "@/lib/grades";
import { gradeStr } from "@/lib/team-names";
import type { UserListItem } from "@/lib/users";
import type { PickNode } from "./PeoplePicker";

// Active: everyone with a role on a team (Directors too), or the Coach role (not a Director) without a team yet.
export const activeCoaches = (users: UserListItem[]) =>
  users.filter((u) => u.active && (u.teams.length > 0 || (u.coach && !u.director)));
export const inactiveCoaches = (users: UserListItem[]) => users.filter((u) => !u.active && !u.director);

const GENDERS = ["Boys", "Girls", "Coed"];
const gradeName = (g: number) => (g === -1 ? "Pre-K" : gradeLabel(gradeStr(g)));

export function coachTree(users: UserListItem[]): PickNode[] {
  const people = activeCoaches(users);
  const out: PickNode[] = [];
  for (const gender of GENDERS) {
    const links = people.flatMap((u) => (u.teamLinks ?? []).filter((t) => t.gender === gender).map((t) => ({ u, t })));
    if (!links.length) continue;
    const grades = [...new Set(links.map((l) => l.t.grade))].sort((a, b) => a - b);
    out.push({
      key: gender,
      label: gender,
      children: grades.map((g) => {
        const inGrade = links.filter((l) => l.t.grade === g);
        const teams = [...new Map(inGrade.map((l) => [l.t.id, l.t.label.split(" · ")[0]])).entries()].sort((a, b) =>
          a[1].localeCompare(b[1]),
        );
        return {
          key: `${gender}-${g}`,
          label: gradeName(g),
          children: teams.map(([id, name]) => ({
            key: `t${id}`,
            label: name,
            children: inGrade
              .filter((l) => l.t.id === id)
              .map((l) => ({
                key: `t${id}-${l.u.coachId}`,
                label: `${l.u.firstName} ${l.u.lastName}`,
                sub: l.t.label.split(" · ")[1],
                cell: l.u.cell,
              })),
          })),
        };
      }),
    });
  }
  const loose = people.filter((u) => !(u.teamLinks ?? []).length);
  if (loose.length)
    out.push({
      key: "none",
      label: "No team yet",
      children: loose.map((u) => ({ key: `n-${u.coachId}`, label: `${u.firstName} ${u.lastName}`, sub: "Coach", cell: u.cell })),
    });
  return out;
}

export function volunteerTree(groups: CoachGroup[]): PickNode[] {
  return GENDERS.flatMap((gender) => {
    const mine = groups.filter((g) => g.gender === gender && g.coaches.length);
    if (!mine.length) return [];
    return [
      {
        key: `v-${gender}`,
        label: gender,
        children: mine.map((g) => ({
          key: `v-${gender}-${g.grade}`,
          label: gradeLabel(g.grade),
          children: [
            { head: true, label: "Head Coach" },
            { head: false, label: "Asst Coach" },
          ]
            .map((r) => ({ ...r, list: g.coaches.filter((c) => c.isHead === r.head) }))
            .filter((r) => r.list.length)
            .map((r) => ({
              key: `v-${gender}-${g.grade}-${r.head ? "h" : "a"}`,
              label: r.label,
              children: r.list.map((c) => ({
                key: `v-${c.registrantId}`,
                label: `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim() || c.name || "Volunteer",
                sub: `Parent of ${c.playerName}`,
                cell: c.cell,
              })),
            })),
        })),
      },
    ];
  });
}
